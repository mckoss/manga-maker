import type { z } from 'zod';
import {
	extractJson,
	TextModelError,
	type ChatMessage,
	type TextAttempt,
	type TextModel,
	type TextRun
} from './text';

/** The request options every chat is sent with. */
const OPTIONS = { think: false, options: { temperature: 0.7 } };

/**
 * Ollama's chat API. Its MLX models don't support the `format` (structured
 * output) option, so the JSON is requested in the prompt, extracted and
 * validated, with one retry that shows the model its mistake.
 */
export class Ollama implements TextModel {
	constructor(
		private model = process.env.OLLAMA_MODEL ?? 'qwen3.8:27b-mlx',
		private baseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
	) {}

	get name(): string {
		return this.model;
	}

	private async chat(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
		let res: Response;
		try {
			res = await fetch(new URL('/api/chat', this.baseUrl), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model: this.model,
					messages,
					stream: false,
					...OPTIONS
				}),
				signal
			});
		} catch (e) {
			throw new TextModelError(
				`Ollama is not reachable at ${this.baseUrl}: ${(e as Error).message}`
			);
		}
		const body = (await res.json()) as { message?: { content: string }; error?: string };
		if (!res.ok || body.error) throw new TextModelError(`Ollama: ${body.error ?? res.status}`);
		return body.message?.content ?? '';
	}

	async json<T>(
		messages: ChatMessage[],
		schema: z.ZodType<T>,
		signal?: AbortSignal
	): Promise<{ value: T; run: TextRun<T> }> {
		const attempts: TextAttempt[] = [];
		const done = (value: T) => ({
			value,
			run: { model: this.model, options: OPTIONS, messages, attempts, parsed: value }
		});
		const reply = await this.chat(messages, signal);
		attempts.push({ reply });
		try {
			return done(schema.parse(extractJson(reply)));
		} catch (e) {
			attempts[0]!.error = (e as Error).message;
			const added: ChatMessage[] = [
				{ role: 'assistant', content: reply },
				{
					role: 'user',
					content: `That reply could not be used: ${(e as Error).message}\nReply again with only the corrected JSON object.`
				}
			];
			const again = await this.chat([...messages, ...added], signal);
			attempts.push({ added, reply: again });
			return done(schema.parse(extractJson(again)));
		}
	}
}
