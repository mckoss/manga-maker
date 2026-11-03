/**
 * Story structures a chapter's plot can follow, and the story elements every
 * plot names. Shared by the server (the AI's instructions) and the pages.
 */

export interface Beat {
	key: string;
	label: string;
	/** What happens in this beat, for the user and the AI. */
	hint: string;
}

export interface Structure {
	label: string;
	/** When to use it. */
	bestFor: string;
	beats: Beat[];
}

export const STRUCTURES = {
	'three-act': {
		label: 'Three-act',
		bestFor: 'A self-contained chapter with a clear goal and opponent.',
		beats: [
			{ key: 'setup', label: 'Setup', hint: 'The protagonist’s world and what they want.' },
			{
				key: 'inciting',
				label: 'Inciting incident',
				hint: 'The event that disrupts the world and starts the conflict.'
			},
			{
				key: 'rising',
				label: 'Rising action',
				hint: 'Attempts and obstacles; the conflict escalates.'
			},
			{
				key: 'midpoint',
				label: 'Midpoint turn',
				hint: 'A reversal or revelation that raises the stakes or changes the goal.'
			},
			{
				key: 'crisis',
				label: 'Crisis',
				hint: 'The lowest point: everything seems lost; a hard choice.'
			},
			{
				key: 'climax',
				label: 'Climax',
				hint: 'The decisive confrontation with the opposing force.'
			},
			{ key: 'resolution', label: 'Resolution', hint: 'The outcome of the climax.' },
			{
				key: 'denouement',
				label: 'Dénouement',
				hint: 'The new normal: what has changed, loose ends tied.'
			}
		]
	},
	freytag: {
		label: 'Freytag’s pyramid',
		bestFor: 'Tragedy, or a story about consequences, where the aftermath matters.',
		beats: [
			{
				key: 'exposition',
				label: 'Exposition',
				hint: 'The characters, the place and the tension under the surface.'
			},
			{
				key: 'rising',
				label: 'Rising action',
				hint: 'Complications build toward the turning point.'
			},
			{
				key: 'climax',
				label: 'Climax',
				hint: 'The turning point: the protagonist’s fortunes reverse.'
			},
			{
				key: 'falling',
				label: 'Falling action',
				hint: 'The consequences of the climax play out.'
			},
			{
				key: 'denouement',
				label: 'Dénouement',
				hint: 'The final outcome and what it means.'
			}
		]
	},
	kishotenketsu: {
		label: 'Kishōtenketsu (起承転結)',
		bestFor: 'Classic manga and slice-of-life: a twist recasts everything; conflict is optional.',
		beats: [
			{ key: 'ki', label: 'Ki (introduction)', hint: 'The characters and situation.' },
			{
				key: 'sho',
				label: 'Shō (development)',
				hint: 'The situation deepens, without a major change.'
			},
			{
				key: 'ten',
				label: 'Ten (twist)',
				hint: 'An unexpected turn or new element that changes how we see it.'
			},
			{
				key: 'ketsu',
				label: 'Ketsu (reconciliation)',
				hint: 'The parts come together in a new understanding.'
			}
		]
	},
	serial: {
		label: 'Serial chapter',
		bestFor:
			'A chapter in an ongoing series: the resolution is deferred and a hook replaces the dénouement.',
		beats: [
			{ key: 'hook', label: 'Hook', hint: 'A cold open that grabs the reader on page one.' },
			{
				key: 'complication',
				label: 'Complication',
				hint: 'The chapter’s problem arrives or the ongoing one worsens.'
			},
			{
				key: 'escalation',
				label: 'Escalation',
				hint: 'The pressure builds; choices narrow.'
			},
			{
				key: 'turn',
				label: 'Partial win or loss',
				hint: 'Something is settled, at a cost, or something is lost.'
			},
			{
				key: 'cliffhanger',
				label: 'Cliffhanger',
				hint: 'A reveal or danger that makes the reader need the next chapter.'
			}
		]
	},
	mystery: {
		label: 'Mystery / reveal',
		bestFor: 'Puzzles, secrets and hidden identities.',
		beats: [
			{
				key: 'setup',
				label: 'Setup and clue',
				hint: 'The question is posed; the first clue is planted.'
			},
			{
				key: 'investigation',
				label: 'Investigation',
				hint: 'The protagonist gathers clues and meets resistance.'
			},
			{
				key: 'false-lead',
				label: 'False lead',
				hint: 'A wrong answer that seems right, or a misdirection.'
			},
			{
				key: 'reveal',
				label: 'Reveal',
				hint: 'The truth, which the clues fairly set up.'
			},
			{
				key: 'aftermath',
				label: 'Aftermath',
				hint: 'What the truth costs or changes.'
			}
		]
	},
	'heros-journey': {
		label: 'Hero’s journey (condensed)',
		bestFor: 'Origin chapters, or a character’s first big test.',
		beats: [
			{
				key: 'ordinary',
				label: 'Ordinary world',
				hint: 'The hero before the adventure, and what they lack.'
			},
			{
				key: 'call',
				label: 'Call to adventure',
				hint: 'The challenge appears; the hero may refuse at first.'
			},
			{
				key: 'threshold',
				label: 'Crossing the threshold',
				hint: 'The hero commits and enters the unknown.'
			},
			{
				key: 'trials',
				label: 'Trials and allies',
				hint: 'Tests, friends and enemies.'
			},
			{
				key: 'ordeal',
				label: 'Ordeal',
				hint: 'The greatest challenge; something in the hero dies or changes.'
			},
			{ key: 'reward', label: 'Reward', hint: 'What the hero gains from the ordeal.' },
			{
				key: 'return',
				label: 'Return changed',
				hint: 'The hero comes back transformed, bringing something to their world.'
			}
		]
	}
} satisfies Record<string, Structure>;

export type StructureKey = keyof typeof STRUCTURES;

export const STRUCTURE_KEYS = Object.keys(STRUCTURES) as StructureKey[];

export function isStructure(value: unknown): value is StructureKey {
	return typeof value === 'string' && value in STRUCTURES;
}

/** The story elements every plot names, whatever its structure. */
export const ELEMENTS = [
	{
		kind: 'goal',
		label: 'Protagonist’s goal',
		hint: 'What the protagonist wants in this chapter.'
	},
	{ kind: 'stakes', label: 'Stakes', hint: 'What they lose if they fail.' },
	{
		kind: 'conflict',
		label: 'Central conflict',
		hint: 'Against a person, themselves, society or nature, and how.'
	},
	{
		kind: 'opposition',
		label: 'Opposing force',
		hint: 'Who or what stands in the way, and why.'
	},
	{ kind: 'theme', label: 'Theme', hint: 'What the chapter is about underneath.' },
	{
		kind: 'change',
		label: 'How the protagonist changes',
		hint: 'Who they are at the end that they weren’t at the start.'
	},
	{ kind: 'climax', label: 'Climax', hint: 'The decisive moment.' },
	{ kind: 'resolution', label: 'Resolution', hint: 'How the conflict ends, or is left.' },
	{
		kind: 'ending',
		label: 'Dénouement or hook',
		hint: 'The new normal, or the cliffhanger that leads into the next chapter.'
	}
] as const;

export type ElementKind = (typeof ELEMENTS)[number]['kind'];

export const ELEMENT_KINDS = ELEMENTS.map((e) => e.kind) as ElementKind[];

export function isElementKind(value: unknown): value is ElementKind {
	return typeof value === 'string' && (ELEMENT_KINDS as string[]).includes(value);
}

/** A typical chapter: 16 to 24 pages. */
export const DEFAULT_PAGE_TARGET = 20;
