/** A text-to-image request. */
export interface ImageRequest {
	model: ImageModelId;
	prompt: string;
	seed: number;
	width: number;
	height: number;
}

export interface ImageResult {
	png: Buffer;
	/** The exact backend input, kept with the image so it can be reproduced. */
	workflow: unknown;
}

export type ImageModelId = 'qwen-image' | 'z-image';

/**
 * Both models run few-step distilled samplers at CFG 1, which never reads a
 * negative prompt. Anything to keep out of an image has to be handled in the
 * positive prompt, by describing what is there instead.
 */
export const IMAGE_MODELS: Record<ImageModelId, { label: string }> = {
	'qwen-image': { label: 'Qwen-Image 2512 (Lightning, 4 steps)' },
	'z-image': { label: 'Z-Image Turbo (8 steps)' }
};

export interface ImageModel {
	generate(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
}

/** Largest seed every backend accepts. */
export const MAX_SEED = 2 ** 48;

export function randomSeed(): number {
	return Math.floor(Math.random() * MAX_SEED);
}
