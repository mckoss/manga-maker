import { ComfyUI } from './comfyui';
import { FakeImageModel, FakeTextModel } from './fake';
import type { ImageModel } from './image';
import { Ollama } from './ollama';
import type { ChatMessage, TextModel } from './text';

export interface AiServices {
	image: ImageModel;
	text: TextModel;
}

/**
 * A canned style prompt, so the app is usable end to end without Ollama.
 * The user's feedback is added to it, so a rewrite changes the prompt.
 */
function fakePromptReply(request: string) {
	const feedback = request.match(/^The user's feedback: (.*)$/m)?.[1];
	return {
		prompt: [
			'manga illustration, confident ink line art, screentone shading, clear silhouettes, expressive faces',
			feedback
		]
			.filter(Boolean)
			.join(', '),
		notes: 'Fake AI backend: this is a placeholder prompt, not a real suggestion.'
	};
}

/** Canned sample scenes, one for every kind. */
function fakeScenesReply() {
	return {
		scenes: {
			figure:
				'Full-body view of a traveler in a long coat standing in a neutral pose, plain white background.',
			face: "Close-up of a traveler's face, eyes narrowed against the wind.",
			interior: 'The empty interior of a wooden inn, lanterns and low tables.',
			exterior: 'An empty mountain village street at dawn, wooden houses and mist.',
			action: 'A traveler leaping across a stream, coat flying, speed lines.'
		}
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
		outfit: 'a dark traveling kimono, straw sandals and a wooden staff',
		notes: 'Fake AI backend: this is a placeholder profile, not a real suggestion.'
	};
}

/** Answers each kind of request the app makes with a canned reply. */
export function fakeReply(messages: ChatMessage[]) {
	const system = messages[0]?.content ?? '';
	if (system.includes('story editor')) return fakeCharacterReply();
	if (system.includes('sample scenes')) return fakeScenesReply();
	return fakePromptReply(messages[1]?.content ?? '');
}

/** The local AI services, or fakes when AI_BACKEND=fake. */
export function createAiServices(): AiServices {
	if (process.env.AI_BACKEND === 'fake') {
		return { image: new FakeImageModel(), text: new FakeTextModel(fakeReply) };
	}
	return { image: new ComfyUI(), text: new Ollama() };
}
