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
