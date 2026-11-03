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

/** Canned questions about the description. */
function fakeQuestionsReply() {
	return {
		questions: [
			{ question: 'Which era is it set in?', suggestions: ['The 1700s', 'The 1860s'] },
			{ question: 'What kind of story is it?', suggestions: ['Samurai drama', 'Ghost story'] }
		]
	};
}

/** The description with the answers added, as the AI would fold them in. */
function fakeFoldReply(request: string) {
	const description = request.match(/^The user's description: (.*)$/m)?.[1] ?? '';
	const answers = request.split('their answers:\n')[1] ?? '';
	return { description: `${description} ${answers.split('\n').join(' ')}`.trim() };
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

/** Canned character designs, each a different look. */
function fakeDesignsReply() {
	const looks = [
		['close to the profile', 'long black hair in a high ponytail'],
		['short and stocky, cropped hair', 'cropped hair and a broad build'],
		['lanky, braid, travel cloak', 'a long braid and a narrow face'],
		['wiry, wild hair, goggles', 'wild shoulder-length hair']
	];
	return {
		fixed: ['age: a young woman, from the notes'],
		free: [
			'hair: high ponytail / cropped / long braid / wild',
			'build: slim / stocky / lanky / wiry'
		],
		designs: looks.map(([label, hair]) => ({
			label,
			appearance: `a young woman with ${hair}`,
			outfit: 'a dark traveling kimono and a wooden staff'
		}))
	};
}

/** A canned location profile. */
function fakeLocationReply() {
	return {
		name: 'The Lantern Inn',
		purpose: 'Where the travelers meet and plan.',
		history: 'Built by a retired sailor a century ago.',
		atmosphere: 'Warm, smoky and loud after dark.',
		setting: 'a wooden roadside inn in a mountain pass',
		appearance: 'a long low hall with a sunken hearth, dark beams and sliding paper doors',
		details: 'paper lanterns, low tables, a ship model above the hearth',
		notes: 'Fake AI backend: this is a placeholder location, not a real suggestion.'
	};
}

/** Canned location designs, each a different look. */
function fakeLocationDesignsReply() {
	const looks = [
		['close to the profile', 'a long low hall with a sunken hearth'],
		['cramped, cluttered, one lamp', 'a narrow room crowded with crates'],
		['airy, open veranda', 'an open hall with a veranda over the valley'],
		['ruined, overgrown', 'a half-collapsed hall with vines through the roof']
	];
	return {
		fixed: ['setting: a mountain inn, from the notes'],
		free: ['scale: long / cramped / airy / ruined'],
		designs: looks.map(([label, appearance]) => ({
			label,
			appearance,
			details: 'paper lanterns and low tables'
		}))
	};
}

/** Canned replies for each step of a chapter's plot. */
function fakePlotReply(system: string, request: string) {
	if (system.includes('Choose the story structure'))
		return { structure: 'serial', reason: 'Fake AI backend: a serial chapter ends on a hook.' };
	if (system.includes("Write the chapter's story elements"))
		return {
			goal: 'Aiko wants to reach the inn before the storm.',
			stakes: 'Her letter for her brother will be lost.',
			conflict: 'Against nature, and a stranger who wants the letter.',
			opposition: 'A masked courier who shadows her.',
			theme: 'Trust is earned on the road.',
			change: 'She learns to accept help.',
			climax: 'On the bridge in the storm she lets the old watchman guide her.',
			resolution: 'She reaches the inn with the letter.',
			ending: 'The courier is waiting inside.',
			notes: 'Fake AI backend: placeholder story elements.'
		};
	if (system.includes("Write the chapter's beat outline")) {
		const keys = (request.match(/^Beats to write: (.*)$/m)?.[1] ?? '')
			.split(',')
			.map((k) => k.trim())
			.filter(Boolean);
		return {
			beats: keys.map((key, i) => ({
				key,
				text: `Beat ${i + 1}: something happens (${key}).`,
				pages: 4,
				// The first beat brings in someone new; the rest anyone the series has.
				characters: i === 0 ? ['Old Watchman'] : []
			})),
			notes: 'Fake AI backend: four pages a beat.',
			newCharacters: [{ name: 'Old Watchman', role: 'minor', brief: 'Keeps the bridge lamps lit.' }]
		};
	}
	if (system.includes('Review the outline'))
		return {
			notes: [
				{ kind: 'issue', text: 'The climax relies on luck: let Aiko choose.' },
				{ kind: 'strength', text: 'The hook lands on the last page.' }
			]
		};
	if (system.includes('ask the writer about the gaps'))
		return {
			questions: [
				{ question: 'How should the chapter end?', suggestions: ['A cliffhanger', 'Resolved'] }
			]
		};
	if (system.includes('Rewrite their chapter notes')) {
		const notes = request.match(/^The writer's notes: (.*)$/m)?.[1] ?? '';
		const answers = request.split('their answers:\n')[1] ?? '';
		return { notes: `${notes} ${answers.split('\n').join(' ')}`.trim() };
	}
	return null;
}

/** Answers each kind of request the app makes with a canned reply. */
export function fakeReply(messages: ChatMessage[]) {
	const system = messages[0]?.content ?? '';
	const plot = fakePlotReply(system, messages[1]?.content ?? '');
	if (plot) return plot;
	if (system.includes('location scout')) return fakeLocationReply();
	if (system.includes('designs for one location')) return fakeLocationDesignsReply();
	if (system.includes('story editor')) return fakeCharacterReply();
	if (system.includes('different visual designs')) return fakeDesignsReply();
	if (system.includes('sample scenes')) return fakeScenesReply();
	if (system.includes('Rewrite their description'))
		return fakeFoldReply(messages[1]?.content ?? '');
	if (system.includes('leaves out')) return fakeQuestionsReply();
	return fakePromptReply(messages[1]?.content ?? '');
}

/** The local AI services, or fakes when AI_BACKEND=fake. */
export function createAiServices(): AiServices {
	if (process.env.AI_BACKEND === 'fake') {
		return { image: new FakeImageModel(), text: new FakeTextModel(fakeReply) };
	}
	return { image: new ComfyUI(), text: new Ollama() };
}
