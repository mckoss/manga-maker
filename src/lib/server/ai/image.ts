import type { ImageModelId } from '#lib/models.js';

export { IMAGE_MODELS, type ImageModelId } from '#lib/models.js';

/** A text-to-image request. */
export interface ImageRequest {
	model: ImageModelId;
	prompt: string;
	seed: number;
	width: number;
	height: number;
}

/**
 * An instruction-following edit of one to three images (Qwen-Image-Edit).
 * The first image sets the output's shape; the prompt calls the images
 * "image 1", "image 2" and "image 3".
 */
export interface EditRequest {
	/** The chosen family; those that can't edit use Qwen-Image-Edit 2509. */
	model?: ImageModelId;
	prompt: string;
	images: Buffer[];
	seed: number;
}

export interface ImageResult {
	png: Buffer;
	/** The exact model that drew it (a key of MODEL_LABELS). */
	model: string;
	/** The exact backend input, kept with the image so it can be reproduced. */
	workflow: unknown;
}

export interface ImageModel {
	generate(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
	edit(req: EditRequest, signal?: AbortSignal): Promise<ImageResult>;
}

/** Largest seed every backend accepts. */
export const MAX_SEED = 2 ** 48;

export function randomSeed(): number {
	return Math.floor(Math.random() * MAX_SEED);
}
