import { ComfyUI } from './comfyui';
import type { PromptId } from '../prompts';
import { byPrompt, FakeImageModel, FakeTextModel, type FakeReplyFn } from './fake';
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

/**
 * The user message of a request. Fakes that echo part of the request (the
 * style's feedback, the beats to write, the writer's notes) read it by the
 * labels the steps put in it ("The user's feedback:", "Beats to write:", …),
 * so they depend on the user message's format, never on the system prompt.
 */
const userMessage = (messages: ChatMessage[]) => messages[1]?.content ?? '';

/** A canned beat outline, one beat for each key the request names. */
function fakeBeatsReply(request: string) {
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

/** The writer's chapter notes with the answers added. */
function fakePlotFoldReply(request: string) {
	const notes = request.match(/^The writer's notes: (.*)$/m)?.[1] ?? '';
	const answers = request.split('their answers:\n')[1] ?? '';
	return { notes: `${notes} ${answers.split('\n').join(' ')}`.trim() };
}

/**
 * A canned page layout: as many pages as "Pages to lay out: N" asks, three
 * panels each, with cues and no words.
 */
function fakeScriptLayoutReply(request: string) {
	const n = Number(request.match(/^Pages to lay out: (\d+)$/m)?.[1] ?? 1);
	const shots = ['establishing', 'medium', 'close'];
	return {
		pages: Array.from({ length: n }, (_, p) => ({
			purpose: `Page ${p + 1} of the beat: a fake moment.`,
			turn: p === n - 1,
			panels: shots.map((shot, i) => ({
				shot,
				location: '',
				characters: [],
				action: `Fake panel ${i + 1}: someone does something.`,
				cue: i === 1 ? 'What do they say here?' : ''
			}))
		})),
		notes: 'Fake AI backend: three panels a page.'
	};
}

/**
 * Canned blanks for a page: one panel for each "- panel <id>: …" line the
 * request lists, and "New panels: N" new ones.
 */
function fakeScriptFillReply(request: string) {
	const ids = [...request.matchAll(/^- panel ([a-z0-9]+):/gm)].map((m) => m[1]!);
	const fresh = Number(request.match(/^New panels: (\d+)$/m)?.[1] ?? 0);
	const panel = (id: string, i: number) => ({
		id,
		shot: 'medium',
		location: '',
		characters: [],
		action: `Fake staging ${i + 1}.`,
		cue: 'What do they say here?'
	});
	return {
		purpose: /^Page purpose: \(blank\)$/m.test(request) ? 'A fake purpose for the page.' : '',
		panels: [
			...ids.map(panel),
			...Array.from({ length: fresh }, (_, i) => panel('', ids.length + i))
		],
		notes: ''
	};
}

/**
 * A canned reply for every prompt the app sends, by prompt id. Exhaustive:
 * a new prompt without a fake reply fails the type check.
 */
export const fakeReplies: Record<PromptId, FakeReplyFn> = {
	'style.prompt': (m) => fakePromptReply(userMessage(m)),
	'style.scenes': () => fakeScenesReply(),
	'style.questions': () => fakeQuestionsReply(),
	'style.fold': (m) => fakeFoldReply(userMessage(m)),
	'character.develop': () => fakeCharacterReply(),
	'character.designs': () => fakeDesignsReply(),
	'location.develop': () => fakeLocationReply(),
	'location.designs': () => fakeLocationDesignsReply(),
	'plot.structure': () => ({
		structure: 'serial',
		reason: 'Fake AI backend: a serial chapter ends on a hook.'
	}),
	'plot.elements': () => ({
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
	}),
	'plot.beats': (m) => fakeBeatsReply(userMessage(m)),
	'plot.review': () => ({
		notes: [
			{ kind: 'issue', text: 'The climax relies on luck: let Aiko choose.' },
			{ kind: 'strength', text: 'The hook lands on the last page.' }
		]
	}),
	'plot.questions': () => ({
		questions: [
			{ question: 'How should the chapter end?', suggestions: ['A cliffhanger', 'Resolved'] }
		]
	}),
	'plot.fold': (m) => fakePlotFoldReply(userMessage(m)),
	'script.layout': (m) => fakeScriptLayoutReply(userMessage(m)),
	'script.fill': (m) => fakeScriptFillReply(userMessage(m))
};

/** Answers each request the app makes with the canned reply for its prompt id. */
export const fakeReply = byPrompt(fakeReplies);

/** The local AI services, or fakes when AI_BACKEND=fake. */
export function createAiServices(): AiServices {
	if (process.env.AI_BACKEND === 'fake') {
		return { image: new FakeImageModel(), text: new FakeTextModel(fakeReply) };
	}
	return { image: new ComfyUI(), text: new Ollama() };
}
