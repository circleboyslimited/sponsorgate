import { readFileSync, renameSync, writeFileSync } from "node:fs";

/** Sliding-window rate limiter keyed by source account. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowSeconds: number,
  ) {}

  /** Records a hit and returns true if it's within the limit. */
  take(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowSeconds);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.prune(now);
    return true;
  }

  toJSON(): Record<string, number[]> {
    return Object.fromEntries(this.hits);
  }

  load(saved: Record<string, number[]> | undefined): void {
    this.hits = new Map(Object.entries(saved ?? {}));
  }

  private prune(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowSeconds)) this.hits.delete(key);
    }
  }
}

/** Daily spend cap that resets at 00:00 UTC. */
export class DailyBudget {
  private day = "";
  private spent = 0;

  constructor(private readonly limit: number) {}

  private roll(now: number): void {
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.spent = 0;
    }
  }

  canSpend(amount: number, now: number): boolean {
    this.roll(now);
    return this.spent + amount <= this.limit;
  }

  spend(amount: number, now: number): void {
    this.roll(now);
    this.spent += amount;
  }

  /** Give back budget, e.g. when the network charged less than the max fee. */
  refund(amount: number, now: number): void {
    this.roll(now);
    this.spent = Math.max(0, this.spent - amount);
  }

  remaining(now: number): number {
    this.roll(now);
    return this.limit - this.spent;
  }

  toJSON(): { day: string; spent: number } {
    return { day: this.day, spent: this.spent };
  }

  load(saved: { day: string; spent: number } | undefined): void {
    if (saved) ({ day: this.day, spent: this.spent } = saved);
  }
}

/** What the relayer persists between restarts. */
export interface LimitsState {
  rateLimit: Record<string, number[]>;
  budget: { day: string; spent: number };
}

/** Where limits state lives. Implement it over Redis or a database to share limits between instances. */
export interface StateStore {
  load(): LimitsState | null;
  save(state: LimitsState): void;
}

/** Keeps limits in a JSON file (written atomically), so restarts don't reset them. */
export class FileStateStore implements StateStore {
  constructor(private readonly path: string) {}

  load(): LimitsState | null {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as LimitsState;
    } catch {
      return null;
    }
  }

  save(state: LimitsState): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, this.path);
  }
}

/**
 * Where rate limits and the daily budget are enforced. Every call is a single
 * atomic step, so several relayer instances can share one backend.
 */
export interface LimitsBackend {
  /** Record a sponsored transaction for `account`; false if over its rate limit. */
  take(account: string, now: number): Promise<boolean>;
  /** Reserve `amount` from today's budget; false (and nothing reserved) if it won't fit. */
  reserve(amount: number, now: number): Promise<boolean>;
  /** Give back part of a reservation. */
  refund(amount: number, now: number): Promise<void>;
  remaining(now: number): Promise<number>;
}

/** In-process limits, optionally persisted with a StateStore (one instance). */
export class LocalLimits implements LimitsBackend {
  private readonly limiter: RateLimiter;
  private readonly budget: DailyBudget;

  constructor(
    rateLimit: { max: number; windowSeconds: number },
    dailyBudget: number,
    private readonly store?: StateStore,
  ) {
    this.limiter = new RateLimiter(rateLimit.max, rateLimit.windowSeconds);
    this.budget = new DailyBudget(dailyBudget);
    const saved = store?.load();
    if (saved) {
      this.limiter.load(saved.rateLimit);
      this.budget.load(saved.budget);
    }
  }

  private persist(): void {
    this.store?.save({ rateLimit: this.limiter.toJSON(), budget: this.budget.toJSON() });
  }

  async take(account: string, now: number): Promise<boolean> {
    const ok = this.limiter.take(account, now);
    this.persist();
    return ok;
  }

  async reserve(amount: number, now: number): Promise<boolean> {
    if (!this.budget.canSpend(amount, now)) return false;
    this.budget.spend(amount, now);
    this.persist();
    return true;
  }

  async refund(amount: number, now: number): Promise<void> {
    this.budget.refund(amount, now);
    this.persist();
  }

  async remaining(now: number): Promise<number> {
    return this.budget.remaining(now);
  }
}

/** The one Redis call RedisLimits needs; ioredis and node-redis both provide it. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

// Sliding window: drop old hits, refuse at the limit, else record this hit.
const TAKE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1`;

// Check and spend in one step, so concurrent relayers can't overspend.
const RESERVE = `
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
if spent + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 0 end
redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], 172800)
return 1`;

const REFUND = `
local left = redis.call('DECRBY', KEYS[1], ARGV[1])
if left < 0 then redis.call('SET', KEYS[1], 0, 'KEEPTTL') end
return 1`;

const day = (now: number) => new Date(now * 1000).toISOString().slice(0, 10);

/** Limits shared by every relayer pointed at the same Redis. */
export class RedisLimits implements LimitsBackend {
  private seq = 0;

  constructor(
    private readonly redis: RedisLike,
    private readonly rateLimit: { max: number; windowSeconds: number },
    private readonly dailyBudget: number,
    private readonly prefix = "sponsorgate",
  ) {}

  async take(account: string, now: number): Promise<boolean> {
    // Members must be unique even when several hits share a timestamp.
    const member = `${now}:${process.pid}:${++this.seq}:${Math.random().toString(36).slice(2)}`;
    const ok = await this.redis.eval(TAKE, 1, `${this.prefix}:rl:${account}`, now, this.rateLimit.windowSeconds, this.rateLimit.max, member);
    return Number(ok) === 1;
  }

  async reserve(amount: number, now: number): Promise<boolean> {
    return Number(await this.redis.eval(RESERVE, 1, `${this.prefix}:budget:${day(now)}`, amount, this.dailyBudget)) === 1;
  }

  async refund(amount: number, now: number): Promise<void> {
    await this.redis.eval(REFUND, 1, `${this.prefix}:budget:${day(now)}`, amount);
  }

  async remaining(now: number): Promise<number> {
    const spent = await this.redis.eval("return redis.call('GET', KEYS[1]) or '0'", 1, `${this.prefix}:budget:${day(now)}`);
    return this.dailyBudget - Number(spent);
  }
}
