import { describe, it, expect } from 'vitest';
import { FailureLimiter } from './rate-limit';

describe('FailureLimiter', () => {
	it('locks out after too many failures and unlocks after the window', () => {
		const limiter = new FailureLimiter(3, 1000);
		limiter.fail('kenji', 0);
		limiter.fail('kenji', 100);
		expect(limiter.retryAfter('kenji', 200)).toBe(0);
		limiter.fail('kenji', 200);
		expect(limiter.retryAfter('kenji', 300)).toBe(700);
		expect(limiter.retryAfter('yuki', 300)).toBe(0);
		expect(limiter.retryAfter('kenji', 1000)).toBe(0);
	});

	it('reset clears failures', () => {
		const limiter = new FailureLimiter(1, 1000);
		limiter.fail('kenji', 0);
		limiter.reset('kenji');
		expect(limiter.retryAfter('kenji', 1)).toBe(0);
	});
});
