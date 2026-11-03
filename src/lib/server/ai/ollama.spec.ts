import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Ollama } from './ollama';

afterEach(() => vi.unstubAllGlobals());

/** Stub fetch to answer each chat with the next reply, recording the bodies sent. */
function stubChat(replies: string[]) {
	const sent: { messages: { role: string; content: string }[] }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: unknown, init: RequestInit) => {
			sent.push(JSON.parse(String(init.body)));
			return new Response(JSON.stringify({ message: { content: replies.shift() ?? '' } }));
		})
	);
	return sent;
}

const schema = z.object({ name: z.string() });
const messages = [
	{ role: 'system' as const, content: 'Reply in JSON.' },
	{ role: 'user' as const, content: 'Name her.' }
];

describe('Ollama.json', () => {
	it('returns the value and a run with the one attempt', async () => {
		stubChat(['```json\n{"name": "Aiko"}\n```']);
		const { value, run } = await new Ollama('m1', 'http://ollama.test').json(messages, schema);
		expect(value).toEqual({ name: 'Aiko' });
		expect(run).toEqual({
			model: 'm1',
			options: { think: false, options: { temperature: 0.7 } },
			messages,
			attempts: [{ reply: '```json\n{"name": "Aiko"}\n```' }],
			parsed: { name: 'Aiko' }
		});
	});

	it('captures both attempts when the first reply needs correcting', async () => {
		const sent = stubChat(['{"nom": "Aiko"}', '{"name": "Aiko"}']);
		const { value, run } = await new Ollama('m1', 'http://ollama.test').json(messages, schema);
		expect(value).toEqual({ name: 'Aiko' });
		expect(run.messages).toEqual(messages);
		expect(run.attempts).toHaveLength(2);
		expect(run.attempts[0]).toMatchObject({ reply: '{"nom": "Aiko"}' });
		expect(run.attempts[0].error).toMatch(/name/);
		expect(run.attempts[1].reply).toBe('{"name": "Aiko"}');
		expect(run.attempts[1].error).toBeUndefined();
		// The retry is recorded exactly as sent.
		expect(sent[1].messages).toEqual([...messages, ...run.attempts[1].added!]);
		expect(run.attempts[1].added![0]).toEqual({ role: 'assistant', content: '{"nom": "Aiko"}' });
		expect(run.attempts[1].added![1].content).toMatch(/^That reply could not be used: /);
		expect(sent[0]).toMatchObject({ model: 'm1', stream: false, think: false });
	});

	it('throws when the retry fails too', async () => {
		stubChat(['nothing', 'still nothing']);
		await expect(new Ollama('m1', 'http://ollama.test').json(messages, schema)).rejects.toThrow(
			/no JSON/
		);
	});
});
