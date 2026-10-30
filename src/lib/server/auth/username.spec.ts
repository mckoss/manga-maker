import { describe, it, expect } from 'vitest';
import { normalizeUsername, usernameProblem } from './username';

describe('usernames', () => {
	it('normalizes case and whitespace', () => {
		expect(normalizeUsername('  Someone@Example.COM ')).toBe('someone@example.com');
	});

	it('accepts email-style and plain names', () => {
		expect(usernameProblem('someone@example.com')).toBeNull();
		expect(usernameProblem('kenji_2')).toBeNull();
	});

	it('rejects short names and odd characters', () => {
		expect(usernameProblem('ab')).toMatch(/3 to 254/);
		expect(usernameProblem('has space')).toMatch(/may contain/);
		expect(usernameProblem('.dot-first')).toMatch(/may contain/);
	});
});
