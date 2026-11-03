import { describe, expect, it } from 'vitest';
import { IdError, parseScope, parseSlot, scopeOf, slot, slotKey, slotKeyOf } from './ids';

describe('ids', () => {
	it('builds and reads scopes', () => {
		expect(scopeOf.character(12)).toBe('character:12');
		expect(scopeOf.series(3)).toBe('series:3');
		expect(parseScope('location:7')).toEqual({ kind: 'location', id: 7 });
		expect(parseScope(scopeOf.chapter(0))).toEqual({ kind: 'chapter', id: 0 });
	});

	it('refuses junk scopes', () => {
		for (const bad of [
			'',
			'character',
			'character:',
			'character:x',
			'robot:1',
			'style:1:2',
			'style:-1'
		]) {
			expect(() => parseScope(bad), bad).toThrow(IdError);
		}
		expect(() => scopeOf.style(1.5)).toThrow(IdError);
		expect(() => scopeOf.style(-1)).toThrow(IdError);
	});

	it('builds and reads slots', () => {
		expect(slot('name')).toEqual({ kind: 'name', key: null });
		// Items store "no key" as an empty key.
		expect(slot('name', '')).toEqual({ kind: 'name', key: null });
		expect(slotKey(slot('design', '3'))).toBe('design:3');
		expect(slotKey(slot('name'))).toBe('name');
		expect(slotKeyOf('sheet', 'three-quarter')).toBe('sheet:three-quarter');
		expect(parseSlot('sheet:three-quarter')).toEqual({ kind: 'sheet', key: 'three-quarter' });
		expect(parseSlot('reference')).toEqual({ kind: 'reference', key: null });
	});

	it('refuses junk slots', () => {
		for (const bad of ['', ':1', 'design:', 'design:1:2', 'de sign', 'design:a b']) {
			expect(() => parseSlot(bad), bad).toThrow(IdError);
		}
		expect(() => slot('design', 'a:b')).toThrow(IdError);
		expect(() => slotKey({ kind: '', key: null })).toThrow(IdError);
	});
});
