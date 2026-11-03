import { error, fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { ChapterError, updateChapter } from '#lib/server/chapters.js';
import {
	answerQuestions,
	chooseStructure,
	getPlot,
	isPlotStage,
	plotAccess,
	PlotError,
	requestQuestions,
	requestStage,
	saveBeat,
	saveElement,
	saveNotes,
	setPageTarget,
	skipQuestions,
	syncCast,
	updatePlot
} from '#lib/server/plots.js';
import {
	deleteOtherVersions,
	deleteVersion,
	setLocked,
	useVersion,
	VersionError
} from '#lib/server/versions.js';
import { STRUCTURES, STRUCTURE_KEYS } from '#lib/structures.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	try {
		return {
			plot: getPlot(getDb(), locals.user!.id, Number(params.id), Number(params.ch)),
			structures: STRUCTURE_KEYS.map((key) => ({ key, ...STRUCTURES[key] }))
		};
	} catch (e) {
		if (e instanceof ChapterError) error(404, e.message);
		throw e;
	}
};

/** Run a command; expected errors become a form failure shown on the page. */
async function run(fn: () => unknown, message?: string | ((result: unknown) => string)) {
	try {
		const result = fn();
		const text = typeof message === 'function' ? message(result) : message;
		return text ? { message: text } : undefined;
	} catch (e) {
		if (e instanceof PlotError || e instanceof ChapterError || e instanceof VersionError) {
			return fail(400, { error: e.message });
		}
		throw e;
	}
}

const str = (form: FormData, key: string) => String(form.get(key) ?? '');
const ctx = (locals: App.Locals, params: { id: string; ch: string }) =>
	[getDb(), locals.user!.id, Number(params.id), Number(params.ch)] as const;

const started = (n: unknown) =>
	n === 0 ? 'Nothing to do: everything unlocked is up to date.' : '';

export const actions: Actions = {
	saveLogline: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() =>
			updateChapter(...ctx(locals, params), {
				title: str(form, 'title'),
				logline: str(form, 'logline')
			})
		);
	},
	saveNotes: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => saveNotes(...ctx(locals, params), str(form, 'text')));
	},
	savePages: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => setPageTarget(...ctx(locals, params), Number(str(form, 'pages'))));
	},
	askQuestions: async ({ locals, params }) => run(() => requestQuestions(...ctx(locals, params))),
	answerQuestions: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() =>
			answerQuestions(
				...ctx(locals, params),
				form.getAll('answer').map((a) => String(a))
			)
		);
	},
	skipQuestions: async ({ locals, params }) => run(() => skipQuestions(...ctx(locals, params))),
	chooseStructure: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(
			() => chooseStructure(...ctx(locals, params), str(form, 'structure')),
			'Structure chosen. The story elements and beats are out of date until you update them.'
		);
	},
	saveElement: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() =>
			saveElement(
				...ctx(locals, params),
				str(form, 'kind'),
				str(form, 'text'),
				form.get('keep') === 'on'
			)
		);
	},
	saveBeat: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() =>
			saveBeat(
				...ctx(locals, params),
				str(form, 'key'),
				{
					text: str(form, 'text'),
					pages: Number(str(form, 'pages')),
					characters: form.getAll('character').map(Number),
					newNames: str(form, 'newCharacter').split(',')
				},
				form.get('keep') === 'on'
			)
		);
	},
	/** Generate everything missing or out of date, step by step. */
	update: async ({ request, locals, params }) => {
		const form = await request.formData();
		const stage = str(form, 'stage');
		return run(
			() => updatePlot(...ctx(locals, params), isPlotStage(stage) ? [stage] : undefined),
			started
		);
	},
	/**
	 * Regenerate one item (`which`: "structure", an element's kind, "beat:<key>"
	 * or "review"), or a whole step (`stage`), with the user's guidance.
	 */
	regenerate: async ({ request, locals, params }) => {
		const form = await request.formData();
		const which = str(form, 'which');
		const stage = which
			? which === 'structure' || which === 'review'
				? which
				: which.startsWith('beat:')
					? 'beats'
					: 'elements'
			: str(form, 'stage');
		if (!isPlotStage(stage)) return fail(400, { error: 'Unknown step.' });
		return run(() =>
			requestStage(...ctx(locals, params), stage, {
				only: which || undefined,
				guidance: str(form, 'guidance')
			})
		);
	},
	// Version browsing (VersionNav). The cast follows the beats in use.
	useVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		const [db, ownerId, seriesId, chapterId] = ctx(locals, params);
		return run(() => {
			useVersion(db, plotAccess(db, ownerId, seriesId, chapterId), Number(form.get('versionId')), {
				lock: form.get('lock') === 'on'
			});
			syncCast(db, chapterId);
		});
	},
	lock: async ({ request, locals, params }) => {
		const form = await request.formData();
		const [db, ownerId, seriesId, chapterId] = ctx(locals, params);
		return run(() =>
			setLocked(
				db,
				plotAccess(db, ownerId, seriesId, chapterId),
				Number(form.get('itemId')),
				form.get('locked') === 'on'
			)
		);
	},
	deleteVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		const [db, ownerId, seriesId, chapterId] = ctx(locals, params);
		return run(() => {
			deleteVersion(
				db,
				plotAccess(db, ownerId, seriesId, chapterId),
				Number(form.get('versionId'))
			);
			syncCast(db, chapterId);
		});
	},
	deleteOthers: async ({ request, locals, params }) => {
		const form = await request.formData();
		const [db, ownerId, seriesId, chapterId] = ctx(locals, params);
		return run(
			() =>
				deleteOtherVersions(
					db,
					plotAccess(db, ownerId, seriesId, chapterId),
					Number(form.get('itemId'))
				),
			(n) => `Deleted ${n} older version${n === 1 ? '' : 's'}.`
		);
	}
};
