import sharp from 'sharp';
import type { z } from 'zod';
import type { EditRequest, ImageModel, ImageRequest, ImageResult } from './image';
import { isPromptId, type PromptId } from '../prompts';
import type { ChatMessage, TextModel, TextRequestOptions, TextRun } from './text';

/**
 * Stand-ins for tests, CI and machines without the AI services
 * (AI_BACKEND=fake). Images are flat colors derived from the seed.
 */
export class FakeImageModel implements ImageModel {
	calls: ImageRequest[] = [];
	edits: EditRequest[] = [];

	async generate(req: ImageRequest): Promise<ImageResult> {
		this.calls.push(req);
		const hue = req.seed % 360;
		const png = await sharp({
			create: {
				width: Math.min(req.width, 256),
				height: Math.min(req.height, 256),
				channels: 3,
				background: `hsl(${hue}, 40%, 60%)`
			}
		})
			.png()
			.toBuffer();
		return { png, model: `fake:${req.model}`, workflow: { fake: true, ...req } };
	}

	/** The first input, tinted by the seed, so each edit is a distinct image. */
	async edit(req: EditRequest): Promise<ImageResult> {
		this.edits.push(req);
		const png = await sharp(req.images[0])
			.resize(128, 224)
			.tint(`hsl(${req.seed % 360}, 50%, 50%)`)
			.png()
			.toBuffer();
		return {
			png,
			model: `fake:${req.model ?? 'qwen-image'}`,
			workflow: { fake: true, prompt: req.prompt, seed: req.seed }
		};
	}
}

/**
 * Makes a fake reply to one request, chosen by the prompt id it was made
 * under (never by the system prompt's wording, so rewording a prompt can't
 * change which reply a test gets).
 */
export type FakeResponder = (messages: ChatMessage[], promptId: PromptId) => unknown;

/** A reply maker for one prompt. */
export type FakeReplyFn = (messages: ChatMessage[]) => unknown;

/**
 * A responder from a table of replies by prompt id. A request under a prompt
 * the table leaves out throws, naming it, so a test never gets a reply it
 * did not ask for.
 */
export function byPrompt(replies: Partial<Record<PromptId, FakeReplyFn>>): FakeResponder {
	return (messages, promptId) => {
		const reply = replies[promptId];
		if (!reply) throw new Error(`The fake text model has no reply for prompt "${promptId}".`);
		return reply(messages);
	};
}

/** Returns whatever `respond` produces for the request, validated by the schema. */
export class FakeTextModel implements TextModel {
	readonly name = 'fake-text';
	calls: ChatMessage[][] = [];
	/** The prompt id of each call, alongside `calls`. */
	promptIds: PromptId[] = [];

	constructor(private respond: FakeResponder) {}

	async json<T>(
		messages: ChatMessage[],
		schema: z.ZodType<T>,
		_signal?: AbortSignal,
		options: TextRequestOptions = {}
	): Promise<{ value: T; run: TextRun<T> }> {
		const { promptId } = options;
		if (promptId === undefined)
			throw new Error('The fake text model needs a prompt id: ask it through askJson.');
		if (!isPromptId(promptId))
			throw new Error(`The fake text model got an unknown prompt id "${promptId}".`);
		this.calls.push(messages);
		this.promptIds.push(promptId);
		const raw = this.respond(messages, promptId);
		const value = schema.parse(raw);
		const reply = JSON.stringify(raw) ?? '';
		return {
			value,
			run: { model: this.name, options: {}, messages, attempts: [{ reply }], parsed: value }
		};
	}
}
