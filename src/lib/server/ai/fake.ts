import sharp from 'sharp';
import type { z } from 'zod';
import type { EditRequest, ImageModel, ImageRequest, ImageResult } from './image';
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

/** Returns whatever `respond` produces for the conversation, validated by the schema. */
export class FakeTextModel implements TextModel {
	readonly name = 'fake-text';
	calls: ChatMessage[][] = [];
	/** The prompt id of each call, alongside `calls` (undefined if none was given). */
	promptIds: (string | undefined)[] = [];

	constructor(private respond: (messages: ChatMessage[]) => unknown) {}

	async json<T>(
		messages: ChatMessage[],
		schema: z.ZodType<T>,
		_signal?: AbortSignal,
		options: TextRequestOptions = {}
	): Promise<{ value: T; run: TextRun<T> }> {
		this.calls.push(messages);
		this.promptIds.push(options.promptId);
		const raw = this.respond(messages);
		const value = schema.parse(raw);
		const reply = JSON.stringify(raw) ?? '';
		return {
			value,
			run: { model: this.name, options: {}, messages, attempts: [{ reply }], parsed: value }
		};
	}
}
