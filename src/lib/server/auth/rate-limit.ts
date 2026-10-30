/**
 * Counts failed sign-ins per key (username) in memory and locks the key out
 * after too many within a window. Enough for a server with a handful of users;
 * resets on restart.
 */
export class FailureLimiter {
	private failures = new Map<string, number[]>();

	constructor(
		private maxFailures = 5,
		private windowMs = 15 * 60 * 1000
	) {}

	private recent(key: string, now: number): number[] {
		const times = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
		if (times.length) this.failures.set(key, times);
		else this.failures.delete(key);
		return times;
	}

	/** Milliseconds until `key` may try again, or 0 if it may now. */
	retryAfter(key: string, now = Date.now()): number {
		const times = this.recent(key, now);
		return times.length < this.maxFailures ? 0 : times[0] + this.windowMs - now;
	}

	fail(key: string, now = Date.now()): void {
		this.failures.set(key, [...this.recent(key, now), now]);
	}

	reset(key: string): void {
		this.failures.delete(key);
	}
}

export const loginLimiter = new FailureLimiter();
