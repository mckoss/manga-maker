import type { z } from 'zod';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/** What a caller says about a request, beyond the messages. */
export interface TextRequestOptions {
	/** The registered system prompt the request is made under (see `askJson`). */
	promptId?: string;
}

/** One request to the model and its raw reply, kept even when it could not be used. */
export interface TextAttempt {
	/**
	 * Messages added to the conversation before this attempt: a retry sends
	 * the run's messages, the bad reply and a correction. Absent on the first.
	 */
	added?: ChatMessage[];
	/** The model's raw reply. */
	reply: string;
	/** Why the reply could not be used; absent for the one that was. */
	error?: string;
}

/** What happened when the model was asked: every attempt, and the value it gave. */
export interface TextRun<T = unknown> {
	/** The model's own name. */
	model: string;
	/** The request options (temperature and the like), as sent. */
	options: Record<string, unknown>;
	/** The conversation as first sent. */
	messages: ChatMessage[];
	attempts: TextAttempt[];
	/** The validated value the last attempt gave. */
	parsed: T;
}

export interface TextModel {
	/** The model's own name, recorded on what it writes. */
	readonly name: string;
	/**
	 * Ask for a JSON reply: the value parsed and validated against `schema`,
	 * and the run that produced it (what was sent, each raw reply). Throws
	 * when no attempt gives a valid value; nothing is returned then.
	 */
	json<T>(
		messages: ChatMessage[],
		schema: z.ZodType<T>,
		signal?: AbortSignal,
		options?: TextRequestOptions
	): Promise<{ value: T; run: TextRun<T> }>;
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
