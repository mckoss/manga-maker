import { error, fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { ChapterError } from '#lib/server/chapters.js';
import {
	addPage,
	addPanel,
	checkPage,
	deletePage,
	deletePanel,
	getScript,
	movePage,
	movePanel,
	requestFill,
	requestLayout,
	savePage,
	savePanel,
	saveWords,
	ScriptError
} from '#lib/server/scripts.js';
import { VersionError } from '#lib/server/versions.js';
import { isShot, isTextKind, type Panel, type TextBlock } from '#lib/script.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	try {
		return {
			script: getScript(getDb(), locals.user!.id, Number(params.id), Number(params.ch))
		};
	} catch (e) {
		if (e instanceof ChapterError) error(404, e.message);
		throw e;
	}
};

/** Run a command; expected errors become a form failure shown on the page. */
async function run(fn: () => unknown) {
	try {
		fn();
	} catch (e) {
		if (e instanceof ScriptError || e instanceof ChapterError || e instanceof VersionError) {
			return fail(400, { error: e.message });
		}
		throw e;
	}
}

const str = (form: FormData, key: string) => String(form.get(key) ?? '');
const dir = (form: FormData): -1 | 1 => (str(form, 'dir') === 'up' ? -1 : 1);
const ctx = (locals: App.Locals, params: { id: string; ch: string }) =>
	[getDb(), locals.user!.id, Number(params.id), Number(params.ch)] as const;

export const actions: Actions = {
	addPage: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() =>
			addPage(...ctx(locals, params), str(form, 'beat'), str(form, 'after') || null)
		);
	},
	/** Save only the page fields the form sends. */
	savePage: async ({ request, locals, params }) => {
		const form = await request.formData();
		const fields: Parameters<typeof savePage>[5] = {};
		if (form.has('purpose')) fields.purpose = str(form, 'purpose');
		// A checkbox sends nothing when unchecked: the form marks that it carries one.
		if (form.has('hasTurn')) fields.turn = form.get('turn') === 'on';
		if (form.has('keyPanel')) fields.keyPanel = str(form, 'keyPanel') || null;
		if (form.has('beat')) fields.beat = str(form, 'beat');
		return run(() => savePage(...ctx(locals, params), str(form, 'pageId'), fields));
	},
	movePage: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => movePage(...ctx(locals, params), str(form, 'pageId'), dir(form)));
	},
	deletePage: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => deletePage(...ctx(locals, params), str(form, 'pageId')));
	},
	/** Ask the AI to lay out a beat that has no pages yet: staging only, never words. */
	helpLayout: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => requestLayout(...ctx(locals, params), str(form, 'beat')));
	},
	/** Ask the AI to fill a page's blank staging fields: never what is written, never words. */
	helpFill: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => requestFill(...ctx(locals, params), str(form, 'pageId')));
	},
	checkPage: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => checkPage(...ctx(locals, params), str(form, 'pageId')));
	},
	addPanel: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() =>
			addPanel(...ctx(locals, params), str(form, 'pageId'), str(form, 'after') || null)
		);
	},
	movePanel: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => movePanel(...ctx(locals, params), str(form, 'panelId'), dir(form)));
	},
	deletePanel: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => deletePanel(...ctx(locals, params), str(form, 'panelId')));
	},
	/** Save only the staging fields the form sends. */
	savePanel: async ({ request, locals, params }) => {
		const form = await request.formData();
		const fields: Partial<Pick<Panel, 'shot' | 'location' | 'characters' | 'action' | 'cue'>> = {};
		if (form.has('shot')) {
			const shot = str(form, 'shot');
			if (shot && !isShot(shot)) return fail(400, { error: 'Unknown shot.' });
			fields.shot = isShot(shot) ? shot : '';
		}
		if (form.has('location')) {
			const loc = Number(str(form, 'location'));
			fields.location = Number.isSafeInteger(loc) && loc > 0 ? loc : null;
		}
		// Checkboxes send nothing when none is ticked: the form marks that it carries them.
		if (form.has('hasCharacters')) {
			fields.characters = form
				.getAll('character')
				.map(Number)
				.filter((n) => Number.isSafeInteger(n) && n > 0);
		}
		if (form.has('action')) fields.action = str(form, 'action');
		if (form.has('cue')) fields.cue = str(form, 'cue');
		return run(() => savePanel(...ctx(locals, params), str(form, 'panelId'), fields));
	},
	/** Save a panel's words: repeated blockId, kind, speaker, text fields, in order. */
	saveWords: async ({ request, locals, params }) => {
		const form = await request.formData();
		const ids = form.getAll('blockId').map(String);
		const kinds = form.getAll('kind').map(String);
		const speakers = form.getAll('speaker').map(String);
		const texts = form.getAll('text').map(String);
		const blocks: TextBlock[] = [];
		for (let i = 0; i < ids.length; i++) {
			const kind = kinds[i];
			if (!isTextKind(kind)) return fail(400, { error: 'Unknown kind of text.' });
			const speaker = Number(speakers[i]);
			blocks.push({
				id: ids[i],
				kind,
				speaker:
					kind !== 'caption' && kind !== 'sfx' && Number.isSafeInteger(speaker) && speaker > 0
						? speaker
						: null,
				text: texts[i] ?? ''
			});
		}
		return run(() => saveWords(...ctx(locals, params), str(form, 'panelId'), blocks));
	}
};
