import { describe, it, expect } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from './password';

describe('password hashing', () => {
	it('verifies the right password and rejects a wrong one', async () => {
		const hash = await hashPassword('correct horse battery');
		expect(hash).toMatch(/^scrypt\$65536\$8\$1\$/);
		expect(await verifyPassword('correct horse battery', hash)).toBe(true);
		expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
	});

	it('salts each hash', async () => {
		expect(await hashPassword('same password!')).not.toBe(await hashPassword('same password!'));
	});

	it('rejects malformed stored hashes', async () => {
		expect(await verifyPassword('x', 'bcrypt$whatever')).toBe(false);
		expect(await verifyPassword('x', '')).toBe(false);
	});

	it('enforces length limits', () => {
		expect(passwordProblem('short')).toMatch(/at least 12/);
		expect(passwordProblem('x'.repeat(257))).toMatch(/at most/);
		expect(passwordProblem('twelve chars')).toBeNull();
	});
});
