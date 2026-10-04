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

  remaining(now: number): number {
    this.roll(now);
    return this.limit - this.spent;
  }
}
