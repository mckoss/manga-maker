import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
	definePrompt,
	isPromptId,
	prompt,
	promptChanged,
	promptHash,
	promptTable,
	PROMPT_IDS,
	setPromptOverride,
	type PromptId
} from '.';
import { askJson } from './ask';
import { FakeTextModel } from '../ai/fake';
import { z } from 'zod';

/**
 * Each prompt's hash and length when it was registered. A prompt's wording
 * is part of the app's behaviour: change a text on purpose and update its
 * line here, so the change shows up in review (versions made with the old
 * text then say they were made with an earlier version of the prompt).
 */
const PINNED: Record<PromptId, [hash: string, length: number]> = {
	'style.prompt': ['9e66cbd2dcb5', 1315],
	'style.scenes': ['c8c010ce99d5', 1785],
	'style.questions': ['7dc8a93f6f63', 1078],
	'style.fold': ['3e8043c84b3e', 441],
	'character.develop': ['0acf8879b75a', 2322],
	'character.designs': ['d76b047a8897', 2893],
	'location.develop': ['ca3fe2ea97d0', 1806],
	'location.designs': ['516adc17fc3e', 1883],
	'plot.structure': ['063735583e74', 1652],
	'plot.elements': ['c4b0b732a4b3', 1567],
	'plot.beats': ['a40abc68f347', 1446],
	'plot.review': ['4bc7243f2046', 972],
	'plot.questions': ['d6728d987cfc', 877],
	'plot.fold': ['a00ce028afa1', 471]
};

afterEach(() => setPromptOverride(null));

describe('prompt registry', () => {
	it('registers every text step once, under a namespaced id', () => {
		expect(PROMPT_IDS).toEqual(Object.keys(PINNED));
		expect(new Set(PROMPT_IDS).size).toBe(PROMPT_IDS.length);
		for (const id of PROMPT_IDS) expect(prompt(id).id).toBe(id);
	});

	it('hashes the exact text: the first 12 hex digits of its SHA-256', () => {
		for (const id of PROMPT_IDS) {
			const p = prompt(id);
			expect(p.hash).toBe(createHash('sha256').update(p.text).digest('hex').slice(0, 12));
			expect(p.hash).toMatch(/^[0-9a-f]{12}$/);
			expect(promptHash(p.text)).toBe(p.hash);
		}
		expect(definePrompt('a.b', 'same').hash).toBe(definePrompt('c.d', 'same').hash);
		expect(definePrompt('a.b', 'same').hash).not.toBe(definePrompt('a.b', 'same ').hash);
	});

	it('keeps every text exactly as pinned', () => {
		for (const id of PROMPT_IDS) {
			expect([id, prompt(id).hash, prompt(id).text.length]).toEqual([id, ...PINNED[id]]);
		}
	});

	it('refuses duplicate and malformed ids', () => {
		expect(() => promptTable([definePrompt('x.one', 'a'), definePrompt('x.one', 'b')])).toThrow(
			/defined twice/
		);
		expect(promptTable([definePrompt('x.one', 'a'), definePrompt('x.two', 'a')]).size).toBe(2);
		expect(() => definePrompt('develop', 'a')).toThrow(/Bad prompt id/);
		expect(() => definePrompt('Character.Develop', 'a')).toThrow(/Bad prompt id/);
	});

	it('looks prompts up by id, and says when a recorded hash is no longer current', () => {
		expect(isPromptId('plot.beats')).toBe(true);
		expect(isPromptId('plot.nothing')).toBe(false);
		expect(() => prompt('plot.nothing' as PromptId)).toThrow(/no prompt/);
		const { hash } = prompt('plot.beats');
		expect(promptChanged('plot.beats', hash)).toBe(false);
		expect(promptChanged('plot.beats', 'abcdefabcdef')).toBe(true);
		// Nothing recorded, or a prompt no longer known: never changed, never an error.
		expect(promptChanged('', '')).toBe(false);
		expect(promptChanged('plot.beats', '')).toBe(false);
		expect(promptChanged('plot.nothing', 'abcdefabcdef')).toBe(false);
	});

	it('reads an override first: the seam for edited prompts', () => {
		const builtIn = prompt('style.fold');
		setPromptOverride((id) => (id === 'style.fold' ? `${builtIn.text} Be brief.` : undefined));
		expect(prompt('style.fold').text).toBe(`${builtIn.text} Be brief.`);
		expect(prompt('style.fold').hash).toBe(promptHash(`${builtIn.text} Be brief.`));
		expect(promptChanged('style.fold', builtIn.hash)).toBe(true);
		expect(prompt('style.prompt')).toBe(prompt('style.prompt'));
		setPromptOverride(null);
		expect(prompt('style.fold')).toBe(builtIn);
	});
});

describe('askJson', () => {
	it('sends the prompt first, names it to the model, and returns its stamp', async () => {
		const text = new FakeTextModel(() => ({ ok: 'yes' }));
		const { value, prompt: stamp } = await askJson(
			{ text },
			'plot.review',
			[{ role: 'user', content: 'Look at the outline.' }],
			z.object({ ok: z.string() })
		);
		expect(value).toEqual({ ok: 'yes' });
		expect(stamp).toEqual({ promptId: 'plot.review', promptHash: prompt('plot.review').hash });
		expect(text.calls[0]).toEqual([
			{ role: 'system', content: prompt('plot.review').text },
			{ role: 'user', content: 'Look at the outline.' }
		]);
		expect(text.promptIds).toEqual(['plot.review']);
	});
});
