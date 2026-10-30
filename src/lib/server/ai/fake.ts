import sharp from 'sharp';
import type { z } from 'zod';
import type { ImageModel, ImageRequest, ImageResult } from './image';
import type { ChatMessage, TextModel } from './text';

/**
 * Stand-ins for tests, CI and machines without the AI services
 * (AI_BACKEND=fake). Images are flat colours derived from the seed.
 */
export class FakeImageModel implements ImageModel {
	calls: ImageRequest[] = [];

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
		return { png, workflow: { fake: true, ...req } };
	}
}

/** Returns whatever `respond` produces for the conversation, validated by the schema. */
export class FakeTextModel implements TextModel {
	calls: ChatMessage[][] = [];

	constructor(private respond: (messages: ChatMessage[]) => unknown) {}

	async json<T>(messages: ChatMessage[], schema: z.ZodType<T>): Promise<T> {
		this.calls.push(messages);
		return schema.parse(this.respond(messages));
	}
}
