import { ComfyUI } from './comfyui';
import { FakeImageModel, FakeTextModel } from './fake';
import type { ImageModel } from './image';
import { Ollama } from './ollama';
import type { TextModel } from './text';

export interface AiServices {
	image: ImageModel;
	text: TextModel;
}

/** A canned style draft, so the app is usable end to end without Ollama. */
function fakeStyleReply() {
	return {
		prompt:
			'manga illustration, confident ink line art, screentone shading, clear silhouettes, expressive faces',
		negativePrompt: 'photorealistic, 3d render, blurry, watermark',
		notes: 'Fake AI backend: this is a placeholder draft, not a real suggestion.'
	};
}

/** The local AI services, or fakes when AI_BACKEND=fake. */
export function createAiServices(): AiServices {
	if (process.env.AI_BACKEND === 'fake') {
		return { image: new FakeImageModel(), text: new FakeTextModel(fakeStyleReply) };
	}
	return { image: new ComfyUI(), text: new Ollama() };
}
