import type { z } from 'zod';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface TextModel {
	/** Ask for a JSON reply and return it parsed and validated against `schema`. */
	json<T>(messages: ChatMessage[], schema: z.ZodType<T>, signal?: AbortSignal): Promise<T>;
}

export class TextModelError extends Error {}

/** Pull the JSON object out of a model reply (which may wrap it in a code fence or prose). */
export function extractJson(reply: string): unknown {
	const start = reply.indexOf('{');
	const end = reply.lastIndexOf('}');
	if (start < 0 || end < start) throw new TextModelError('The reply contained no JSON object.');
	try {
		return JSON.parse(reply.slice(start, end + 1));
	} catch (e) {
		throw new TextModelError(`The reply was not valid JSON: ${(e as Error).message}`);
	}
}
