/** A text-to-image request. */
export interface ImageRequest {
	model: ImageModelId;
	prompt: string;
	negativePrompt?: string;
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

export const IMAGE_MODELS: Record<ImageModelId, { label: string; negativePrompt: boolean }> = {
	'qwen-image': { label: 'Qwen-Image 2512 (Lightning, 4 steps)', negativePrompt: true },
	// Distilled: CFG 1, so a negative prompt has no effect.
	'z-image': { label: 'Z-Image Turbo (8 steps)', negativePrompt: false }
};

export interface ImageModel {
	generate(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
}

/** Largest seed every backend accepts. */
export const MAX_SEED = 2 ** 48;

export function randomSeed(): number {
	return Math.floor(Math.random() * MAX_SEED);
}
