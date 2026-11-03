import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fakeReplies, fakeReply } from '.';
import { askJson } from '../prompts/ask';
import { prompt, PROMPT_IDS, setPromptOverride } from '../prompts';
import { byPrompt, FakeTextModel } from './fake';

const anything = z.unknown();

describe('fake text replies', () => {
	afterEach(() => setPromptOverride(null));

	it('has a reply for every prompt, and none for prompts that do not exist', () => {
		expect(Object.keys(fakeReplies).sort()).toEqual([...PROMPT_IDS].sort());
		for (const id of PROMPT_IDS) expect(typeof fakeReplies[id]).toBe('function');
	});

	it('picks the reply by prompt id, however the prompt is worded', async () => {
		setPromptOverride((id) => `Reworded instructions for ${id}. Reply in JSON.`);
		const text = new FakeTextModel(fakeReply);
		const user = { role: 'user' as const, content: 'Beats to write: hook, climax' };
		for (const id of PROMPT_IDS) {
			const { value } = await askJson({ text }, id, [user], anything);
			expect(text.calls.at(-1)![0].content).toBe(`Reworded instructions for ${id}. Reply in JSON.`);
			expect(value).toEqual(fakeReplies[id]([{ role: 'system', content: prompt(id).text }, user]));
		}
		const { value: place } = await askJson({ text }, 'location.develop', [user], anything);
		expect(place).toMatchObject({ name: 'The Lantern Inn' });
		const { value: beats } = await askJson({ text }, 'plot.beats', [user], anything);
		expect((beats as { beats: { key: string }[] }).beats.map((b) => b.key)).toEqual([
			'hook',
			'climax'
		]);
		expect(text.promptIds).toEqual([...PROMPT_IDS, 'location.develop', 'plot.beats']);
	});

	it('refuses a request without a known prompt id', async () => {
		const text = new FakeTextModel(fakeReply);
		const messages = [{ role: 'user' as const, content: 'Hello' }];
		await expect(text.json(messages, anything)).rejects.toThrow(/needs a prompt id/);
		await expect(text.json(messages, anything, undefined, { promptId: 'nope' })).rejects.toThrow(
			/unknown prompt id "nope"/
		);
		expect(text.calls).toEqual([]);
	});

	it('byPrompt refuses a prompt its table leaves out', async () => {
		const text = new FakeTextModel(byPrompt({ 'style.prompt': () => ({ ok: true }) }));
		const user = [{ role: 'user' as const, content: 'Hello' }];
		expect((await askJson({ text }, 'style.prompt', user, anything)).value).toEqual({ ok: true });
		await expect(askJson({ text }, 'style.scenes', user, anything)).rejects.toThrow(
			/no reply for prompt "style.scenes"/
		);
	});
});
