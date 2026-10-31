import { ComfyUI } from './comfyui';
import { FakeImageModel, FakeTextModel } from './fake';
import type { ImageModel } from './image';
import { Ollama } from './ollama';
import type { ChatMessage, TextModel } from './text';

export interface AiServices {
	image: ImageModel;
	text: TextModel;
}

/** A canned style draft, so the app is usable end to end without Ollama. */
function fakeStyleReply() {
	return {
		prompt:
			'manga illustration, confident ink line art, screentone shading, clear silhouettes, expressive faces',
		scenes: {
			figure:
				'Full-body view of a traveller in a long coat standing in a neutral pose, plain white background.',
			exterior: 'An empty mountain village street at dawn, wooden houses and mist. No people.'
		},
		notes: 'Fake AI backend: this is a placeholder draft, not a real suggestion.'
	};
}

/** A canned character profile. */
function fakeCharacterReply() {
	return {
		name: 'Aiko',
		personality: 'Stubborn and kind. Too proud to ask for help.',
		motivation: 'Wants to find her brother; needs to forgive him.',
		backstory: 'Raised in a mountain village by her grandmother.',
		speech: 'Short, blunt sentences.',
		age: 'a young woman of about twenty',
		appearance:
			'slim and tall, sharp eyes, long black hair in a high ponytail, a small scar on her chin',
		outfit: 'a dark travelling kimono, straw sandals and a wooden staff',
		notes: 'Fake AI backend: this is a placeholder profile, not a real suggestion.'
	};
}

/** Answers each kind of request the app makes with a canned reply. */
function fakeReply(messages: ChatMessage[]) {
	return messages[0]?.content.includes('story editor') ? fakeCharacterReply() : fakeStyleReply();
}

/** The local AI services, or fakes when AI_BACKEND=fake. */
export function createAiServices(): AiServices {
	if (process.env.AI_BACKEND === 'fake') {
		return { image: new FakeImageModel(), text: new FakeTextModel(fakeReply) };
	}
	return { image: new ComfyUI(), text: new Ollama() };
}
