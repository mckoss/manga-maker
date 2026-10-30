import { describe, expect, it } from 'vitest';
import { extractJson } from './text';

describe('extractJson', () => {
	it('finds the object inside code fences and prose', () => {
		expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
	});
	it('rejects replies without valid JSON', () => {
		expect(() => extractJson('no json here')).toThrow(/no JSON/);
		expect(() => extractJson('{not: json}')).toThrow(/not valid JSON/);
	});
});
