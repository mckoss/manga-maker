/**
 * The image models a user can choose, and the names of every model that
 * can be recorded on a version. Shared by the server and the pages.
 */

/** What a user chooses: a model family for drawing new pictures. */
export type ImageModelId =
	'qwen-image' | 'z-image' | 'qwen-image-2.1' | 'qwen-image-2.1-full' | 'qwen-image-2.1-strong';

export const DEFAULT_IMAGE_MODEL: ImageModelId = 'qwen-image';

/**
 * Both Qwen-Image 2512 and Z-Image only draw from text; pictures edited from
 * others (sheets, the logo) use Qwen-Image-Edit 2509 with them. Qwen-Image
 * 2.1 both draws and edits, either fast (Turbo, 8 steps) or in full (25
 * steps, about three times as long, for more detail). The strong-prompt
 * variant also weighs the prompt more heavily and steers away from the
 * series' Avoid list (a negative prompt), at twice the time again. The
 * other models are distilled for speed and can't do either.
 */
export const IMAGE_MODELS: Record<ImageModelId, { label: string; edits: string }> = {
	'qwen-image': { label: 'Qwen-Image 2512', edits: 'edits with Qwen-Image-Edit 2509' },
	'z-image': { label: 'Z-Image Turbo', edits: 'edits with Qwen-Image-Edit 2509' },
	'qwen-image-2.1': { label: 'Qwen-Image 2.1 Turbo', edits: 'draws and edits' },
	'qwen-image-2.1-full': {
		label: 'Qwen-Image 2.1 (25 steps)',
		edits: 'draws and edits; slower, more detail'
	},
	'qwen-image-2.1-strong': {
		label: 'Qwen-Image 2.1, strong prompt',
		edits: 'follows the prompt more closely and avoids the Avoid list; slowest'
	}
};

/** Models that steer away from a negative prompt (the series' Avoid list). */
export const AVOIDS: ReadonlySet<ImageModelId> = new Set(['qwen-image-2.1-strong']);

/** What the strong-prompt model avoids when a series hasn't listed its own. */
export const DEFAULT_AVOID =
	'text, lettering, captions, speech bubbles, watermark, signature, blurry, low quality, deformed hands, extra fingers, extra limbs';

export function isImageModel(value: unknown): value is ImageModelId {
	return typeof value === 'string' && value in IMAGE_MODELS;
}

/** The exact models that ran, as recorded on versions. */
export const MODEL_LABELS: Record<string, string> = {
	'qwen-image-2512': 'Qwen-Image 2512 (Lightning 4-step)',
	'z-image-turbo': 'Z-Image Turbo',
	'qwen-image-2.1-turbo': 'Qwen-Image 2.1 Turbo',
	'qwen-image-2.1': 'Qwen-Image 2.1 (25 steps)',
	'qwen-image-2.1-strong': 'Qwen-Image 2.1 (25 steps, strong prompt)',
	'qwen-image-edit-2509': 'Qwen-Image-Edit 2509 (Lightning 4-step)'
};

/** A recorded model's name: a known label, or the model's own name (text models). */
export function modelLabel(model: string): string {
	return MODEL_LABELS[model] ?? (isImageModel(model) ? IMAGE_MODELS[model].label : model);
}

export const imageModelOptions = () =>
	Object.entries(IMAGE_MODELS).map(([value, m]) => ({ value, label: m.label, edits: m.edits }));
