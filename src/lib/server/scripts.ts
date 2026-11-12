/**
 * A chapter's script (see "3b. Script" in PLAN.md and the types in
 * `#lib/script.js`): pages → panels → words, as versioned items in the scope
 * `script:<chapterId>`. Every command here is the user's own edit
 * (origin 'user'). Script items are never locked: the AI help jobs (later)
 * write only into blank staging fields and never write words.
 *
 * STUB: the signatures are the contract with the page; the bodies are being
 * written.
 */
import type { Db } from './db';
import type { Panel, ScriptDetail, TextBlock } from '#lib/script.js';
import type { Access } from './versions';

export class ScriptError extends Error {}

type Ctx = [db: Db, ownerId: number, seriesId: number, chapterId: number];

const todo = (): never => {
	throw new Error('Not built yet.');
};

/** Who may change a chapter's script items. */
export function scriptAccess(...[]: Ctx): Access {
	return todo();
}

export function getScript(...[]: Ctx): ScriptDetail {
	return todo();
}

/** Add a page to a beat, after `after` (a page id) or at the end of the beat's pages. Returns its id. */
export function addPage(...[]: [...Ctx, beat: string, after?: string | null]): string {
	return todo();
}

export function savePage(
	...[]: [
		...Ctx,
		pageId: string,
		fields: { purpose?: string; turn?: boolean; keyPanel?: string | null; beat?: string }
	]
): void {
	todo();
}

/** Move a page one place earlier (-1) or later (1) among its beat's pages. */
export function movePage(...[]: [...Ctx, pageId: string, dir: -1 | 1]): void {
	todo();
}

/** Delete a page with its panels and their words. */
export function deletePage(...[]: [...Ctx, pageId: string]): void {
	todo();
}

/** The user has looked at a page after its beat changed: it is no longer flagged. */
export function checkPage(...[]: [...Ctx, pageId: string]): void {
	todo();
}

/** Add a panel to a page, after `after` (a panel id) or at the end. Returns its id. */
export function addPanel(...[]: [...Ctx, pageId: string, after?: string | null]): string {
	return todo();
}

/** Move a panel one place earlier (-1) or later (1) on its page. */
export function movePanel(...[]: [...Ctx, panelId: string, dir: -1 | 1]): void {
	todo();
}

export function deletePanel(...[]: [...Ctx, panelId: string]): void {
	todo();
}

/** Save the user's staging fields; a field they change is no longer an "AI draft". */
export function savePanel(
	...[]: [
		...Ctx,
		panelId: string,
		fields: Partial<Pick<Panel, 'shot' | 'location' | 'characters' | 'action' | 'cue'>>
	]
): void {
	todo();
}

/** Save a panel's words (the whole list, in order). */
export function saveWords(...[]: [...Ctx, panelId: string, blocks: TextBlock[]]): void {
	todo();
}
