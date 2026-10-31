import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { IMAGE_MODELS } from '#lib/server/ai/image.js';
import {
	mangaStyleId,
	MangaError,
	removeStyle,
	reusableStyles,
	reuseStyle,
	startStyle
} from '#lib/server/mangas.js';
import {
	approveDraft,
	COLOR_MODES,
	discardDraft,
	getStyle,
	isColorMode,
	isImageModel,
	readyToApprove,
	requestRefine,
	requestSamples,
	SAMPLE_SUBJECTS,
	samplePrompt,
	sceneFor,
	startRevision,
	StyleError,
	updateDraft
} from '#lib/server/styles.js';
import type { Actions, PageServerLoad } from './$types';

const colorModes = Object.entries(COLOR_MODES).map(([value, m]) => ({ value, label: m.label }));
const models = Object.entries(IMAGE_MODELS).map(([value, m]) => ({ value, label: m.label }));

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	const { manga } = await parent();
	const db = getDb();
	const ownerId = locals.user!.id;
	if (!manga.styleId) {
		return {
			editor: null,
			colorModes,
			models,
			reusable: reusableStyles(db, ownerId, Number(params.id))
		};
	}
	const detail = getStyle(db, ownerId, manga.styleId);
	const { draft, samples } = detail;
	/** Samples for a version in subject order, flagging ones made from an older prompt. */
	const sampleRow = (versionId: number | undefined) =>
		SAMPLE_SUBJECTS.map((subject) => {
			const sample = samples.find((s) => s.versionId === versionId && s.subject === subject.key);
			const version = versionId === draft?.id ? draft : undefined;
			return {
				subject: subject.key,
				label: subject.label,
				sample: sample ?? null,
				stale: Boolean(sample && version && sample.prompt !== samplePrompt(version, subject.key))
			};
		});
	const editor = {
		...detail,
		colorModes,
		models,
		activeSamples: sampleRow(detail.active?.id),
		draftSamples: sampleRow(draft?.id),
		draftScenes: draft
			? SAMPLE_SUBJECTS.map((s) => ({ key: s.key, label: s.label, scene: sceneFor(draft, s.key) }))
			: [],
		historySamples: Object.fromEntries(detail.history.map((v) => [v.id, sampleRow(v.id)])),
		canApprove: draft ? readyToApprove(draft, samples) : false,
		colorLabels: Object.fromEntries(Object.entries(COLOR_MODES).map(([k, m]) => [k, m.label]))
	};
	return { editor, colorModes, models, reusable: [] };
};

/** Run a style command; StyleErrors become a form failure shown on the page. */
async function run(fn: () => unknown, message?: string) {
	try {
		await fn();
		return message ? { message } : undefined;
	} catch (e) {
		if (e instanceof StyleError || e instanceof MangaError) return fail(400, { error: e.message });
		throw e;
	}
}

const num = (form: FormData, key: string) => Number(form.get(key));
const str = (form: FormData, key: string) => String(form.get(key) ?? '');

export const actions: Actions = {
	start: async ({ request, locals, params }) => {
		const form = await request.formData();
		const colorMode = str(form, 'colorMode');
		const model = str(form, 'model');
		if (!isColorMode(colorMode) || !isImageModel(model)) {
			return fail(400, { error: 'Choose a colour mode and a model.' });
		}
		return run(() =>
			startStyle(getDb(), locals.user!.id, Number(params.id), {
				description: str(form, 'description'),
				colorMode,
				model
			})
		);
	},
	reuse: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(
			() => reuseStyle(getDb(), locals.user!.id, Number(params.id), num(form, 'styleId')),
			'Style copied. It is approved and ready to use; revise it if you like.'
		);
	},
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const colorMode = str(form, 'colorMode');
		const model = str(form, 'model');
		if (!isColorMode(colorMode) || !isImageModel(model)) {
			return fail(400, { error: 'Choose a colour mode and a model.' });
		}
		return run(
			() =>
				updateDraft(getDb(), locals.user!.id, num(form, 'versionId'), {
					description: str(form, 'description'),
					prompt: str(form, 'prompt'),
					avoid: str(form, 'avoid'),
					scenes: Object.fromEntries(
						SAMPLE_SUBJECTS.map((s) => [s.key, str(form, `scene_${s.key}`)])
					),
					colorMode,
					model
				}),
			'Draft saved.'
		);
	},
	refine: async ({ request, locals }) => {
		const form = await request.formData();
		return run(() =>
			requestRefine(getDb(), locals.user!.id, num(form, 'versionId'), str(form, 'feedback'))
		);
	},
	samples: async ({ request, locals }) => {
		const form = await request.formData();
		return run(() =>
			requestSamples(getDb(), locals.user!.id, num(form, 'versionId'), {
				newSeed: form.get('newSeed') === 'on'
			})
		);
	},
	approve: async ({ request, locals }) => {
		const form = await request.formData();
		return run(
			() => approveDraft(getDb(), locals.user!.id, num(form, 'versionId')),
			'Approved. This is now the style used for new work.'
		);
	},
	revise: async ({ request, locals, params }) => {
		const form = await request.formData();
		const from = form.get('fromVersionId');
		return run(() => {
			const db = getDb();
			const styleId = mangaStyleId(db, locals.user!.id, Number(params.id));
			startRevision(db, locals.user!.id, styleId, from ? Number(from) : undefined);
		});
	},
	discard: async ({ request, locals }) => {
		const form = await request.formData();
		return run(
			() => discardDraft(getDb(), locals.user!.id, num(form, 'versionId')),
			'Draft discarded.'
		);
	},
	startOver: async ({ locals, params }) =>
		run(() => removeStyle(getDb(), locals.user!.id, Number(params.id)), 'Style removed.')
};
