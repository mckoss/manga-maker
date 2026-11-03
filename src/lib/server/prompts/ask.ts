import type { z } from 'zod';
import type { AiServices } from '../ai';
import type { ChatMessage } from '../ai/text';
import { prompt, type PromptId } from '.';

/** What a version records about the prompt that made it. */
export interface PromptStamp {
	promptId: PromptId;
	promptHash: string;
}

/**
 * Ask the text model one question under a registered system prompt: the
 * prompt's text goes first, then `messages`, and the reply comes back
 * validated by `schema`, with the prompt's id and hash to record on the
 * versions it makes (spread `prompt` into `finishVersion`'s content).
 *
 * Every AI text call goes through here, so a run record (what was sent,
 * the raw replies) or replies routed by prompt id can be added in one place.
 */
export async function askJson<T>(
	ai: Pick<AiServices, 'text'>,
	promptId: PromptId,
	messages: ChatMessage[],
	schema: z.ZodType<T>,
	signal?: AbortSignal
): Promise<{ value: T; prompt: PromptStamp }> {
	const p = prompt(promptId);
	const value = await ai.text.json(
		[{ role: 'system', content: p.text }, ...messages],
		schema,
		signal,
		{ promptId }
	);
	return { value, prompt: { promptId, promptHash: p.hash } };
}
