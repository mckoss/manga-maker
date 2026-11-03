import type { z } from 'zod';
import type { AiServices } from '../ai';
import type { ChatMessage } from '../ai/text';
import { textRunRecord, type TextRunRecord } from '../runs';
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
 * versions it makes (spread `prompt` into `finishVersion`'s content), and
 * the run record (what was sent, each raw reply, the value used) to store
 * with `putRun` as the versions' `runHash`.
 *
 * Every AI text call goes through here, so replies routed by prompt id can
 * be added in one place.
 */
export async function askJson<T>(
	ai: Pick<AiServices, 'text'>,
	promptId: PromptId,
	messages: ChatMessage[],
	schema: z.ZodType<T>,
	signal?: AbortSignal
): Promise<{ value: T; prompt: PromptStamp; run: TextRunRecord }> {
	const p = prompt(promptId);
	const { value, run } = await ai.text.json(
		[{ role: 'system', content: p.text }, ...messages],
		schema,
		signal,
		{ promptId }
	);
	return { value, prompt: { promptId, promptHash: p.hash }, run: textRunRecord(run) };
}
