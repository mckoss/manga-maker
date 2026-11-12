/**
 * The prompt registry: every system prompt the AI text steps use, by
 * namespaced id. Steps never hold a prompt's text themselves; they name it
 * (`askJson(ai, 'style.prompt', ...)`) and `prompt(id)` is the one place its
 * text is read.
 *
 * The texts live in this folder, one module per domain, and are collected
 * here in one table, so a lookup knows every prompt whichever domain modules
 * have loaded, and a dev-server reload rebuilds the table whole.
 *
 * Editing seam: `prompt(id)` asks the override (`setPromptOverride`) first.
 * Nothing sets one in the app yet; a future editor can install one backed
 * by the database (the user's text for an id, or undefined for the built-in
 * one). The override's text is hashed like any other, so versions made
 * before an edit say they were made with an earlier version of the prompt.
 */

import { CHARACTER_DESIGNS, CHARACTER_DEVELOP } from './character';
import { LOCATION_DESIGNS, LOCATION_DEVELOP } from './location';
import {
	PLOT_BEATS,
	PLOT_ELEMENTS,
	PLOT_FOLD,
	PLOT_QUESTIONS,
	PLOT_REVIEW,
	PLOT_STRUCTURE
} from './plot';
import { definePrompt, promptTable, type Prompt } from './registry';
import { SCRIPT_FILL, SCRIPT_LAYOUT } from './script';
import { STYLE_FOLD, STYLE_PROMPT, STYLE_QUESTIONS, STYLE_SCENES } from './style';

export { definePrompt, promptHash, promptTable, type Prompt } from './registry';

const BUILT_IN = [
	STYLE_PROMPT,
	STYLE_SCENES,
	STYLE_QUESTIONS,
	STYLE_FOLD,
	CHARACTER_DEVELOP,
	CHARACTER_DESIGNS,
	LOCATION_DEVELOP,
	LOCATION_DESIGNS,
	PLOT_STRUCTURE,
	PLOT_ELEMENTS,
	PLOT_BEATS,
	PLOT_REVIEW,
	PLOT_QUESTIONS,
	PLOT_FOLD,
	SCRIPT_LAYOUT,
	SCRIPT_FILL
] as const;

export type PromptId = (typeof BUILT_IN)[number]['id'];

const table = promptTable<Prompt>(BUILT_IN);

export const PROMPT_IDS = BUILT_IN.map((p) => p.id) as PromptId[];

export function isPromptId(id: string): id is PromptId {
	return table.has(id);
}

/** Replaces a prompt's text; undefined keeps the built-in one. */
export type PromptOverride = (id: PromptId) => string | undefined;

let override: PromptOverride | null = null;

/** Install (or with null, remove) the override `prompt` reads first. */
export function setPromptOverride(fn: PromptOverride | null): void {
	override = fn;
}

/** The prompt a step sends now: the only read path for a prompt's text. */
export function prompt(id: PromptId): Prompt<PromptId> {
	const builtIn = table.get(id);
	if (!builtIn) throw new Error(`There is no prompt "${id}".`);
	const text = override?.(id);
	return text === undefined || text === builtIn.text
		? (builtIn as Prompt<PromptId>)
		: definePrompt(id, text);
}

/**
 * Whether a version was made with an earlier text of its prompt. Versions
 * made before prompts were recorded (an empty hash), and prompts no longer
 * known, never count as changed. Informational only: it never makes a
 * version out of date.
 */
export function promptChanged(id: string, hash: string): boolean {
	if (!hash || !isPromptId(id)) return false;
	return hash !== prompt(id).hash;
}
