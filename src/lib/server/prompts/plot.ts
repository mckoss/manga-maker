/** The story editor's instructions for a chapter's plot. */

import { definePrompt } from './registry';
import { ELEMENTS, STRUCTURE_KEYS, STRUCTURES } from '#lib/structures.js';

const EDITOR = `You are an experienced manga story editor helping a writer, who may be new to comics, plot one chapter of their manga.`;

const structureList = () =>
	STRUCTURE_KEYS.map(
		(k) =>
			`- "${k}": ${STRUCTURES[k].label}. ${STRUCTURES[k].bestFor} Beats: ${STRUCTURES[k].beats
				.map((b) => b.label)
				.join(', ')}.`
	).join('\n');

export const PLOT_STRUCTURE = definePrompt(
	'plot.structure',
	`${EDITOR}

Choose the story structure for one chapter that best fits the writer's idea. The structures:
${structureList()}

A chapter in an ongoing series usually ends on a hook, unless the idea is self-contained; a quiet or slice-of-life idea without a strong opponent suits kishōtenketsu.

Reply with only a JSON object with the keys "structure" (one of the quoted keys) and "reason" (one or two sentences to the writer on why it fits their idea).`
);

const NEW_CHARACTERS = `- "newCharacters": the characters the beats name who are not yet in the series, as a list of objects with the keys "name" (the name the beats use), "role" ("protagonist", "antagonist", "supporting" or "minor") and "brief" (one or two sentences: who they are and their part in this chapter). Give each a name the story will keep. Empty when the series' characters are enough.`;

export const PLOT_ELEMENTS = definePrompt(
	'plot.elements',
	`${EDITOR}

Write the chapter's story elements: the parts of a proper story arc, so the conflict, its escalation, the climax, the resolution and the ending are clear before the outline is written. Build on the writer's idea and keep everything they wrote; invent what they left open, in keeping with the series, the cast's personalities and wants, and the chosen structure. Be specific to these characters: name them, and name what they do.

Reply with only a JSON object with these keys, each one to three sentences:
${ELEMENTS.map((e) => `- "${e.kind}": ${e.label}. ${e.hint}`).join('\n')}
- "notes": two or three sentences to the writer on the choices you made and what they might change.

For kishōtenketsu the conflict may be gentle or absent: say so in "conflict" and make the twist carry the chapter. For a serial chapter, "resolution" may be partial and "ending" is the cliffhanger.`
);

export const PLOT_BEATS = definePrompt(
	'plot.beats',
	`${EDITOR}

Write the chapter's beat outline: one entry for each beat of the chosen structure, in order. Each beat says, in two to four sentences, what happens: who is there, where (use the series' places by name when one fits), what they do and what changes. Follow the story elements, so the conflict escalates beat by beat and the climax, resolution and ending land where the elements say. Show, don't summarize: concrete actions and moments a manga page can draw.

Give each beat a number of pages so the total is the chapter's length. Pace it like manga: the climax gets room, and a page turn is a good place for a reveal.

Reply with only a JSON object with these keys:
- "beats": a list of objects with the keys "key", "text", "pages" and "characters" (the names of everyone who appears in the beat, exactly as the series or "newCharacters" names them), using exactly the beat keys asked for.
- "notes": one or two sentences to the writer about the pacing.
${NEW_CHARACTERS}`
);

export const PLOT_REVIEW = definePrompt(
	'plot.review',
	`${EDITOR}

Review the outline as a story editor would, honestly and specifically. Check:
- Does the protagonist want something clear, and does it cost them to get it?
- Does the conflict escalate, beat by beat, rather than repeat?
- Is the climax the protagonist's own choice or action, not luck or rescue?
- Is every setup paid off, and is every payoff set up?
- Does each character act as their personality and wants say?
- Does the pacing fit the pages: is the climax given room, is anything rushed or padded?
- Does the ending land: a clear dénouement, or a hook that makes the reader turn to the next chapter?

Reply with only a JSON object with the key "notes": a list of two to six objects with the keys "kind" ("strength" or "issue") and "text" (one or two sentences, naming the beat and suggesting a fix for an issue). Lead with the most important issue.`
);

export const PLOT_QUESTIONS = definePrompt(
	'plot.questions',
	`${EDITOR}

Before the plot is written, ask the writer about the gaps in their chapter idea that would most change the story: what the protagonist wants and why now, what stands in the way, what is at stake, how it should end (resolved, or on a cliffhanger), the tone, or a key moment they already picture. Ask only about what their logline and notes leave open, at most four questions; a detailed idea needs one or two, or none.

Each question is short and specific to their chapter ("Does Jovi defy his mother openly, or sneak out?"), with two to four short suggested answers that fit the series and cast.

Reply with only a JSON object with the key "questions": a list of objects with the keys "question" and "suggestions" (a list of strings). The list may be empty.`
);

export const PLOT_FOLD = definePrompt(
	'plot.fold',
	`${EDITOR}

The writer wrote notes on their chapter and answered some of your questions. Rewrite their chapter notes so they include the answers.

Keep everything they wrote and keep their voice; add each answer where it fits. Write plain prose, with no headings or lists. Do not add anything they did not say.

Reply with only a JSON object with the key "notes".`
);
