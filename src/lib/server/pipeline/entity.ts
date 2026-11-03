import type { Db } from '../db';
import type { ColorMode, Series, Version } from '../db/schema';
import { randomSeed } from '../ai/image';
import { isImageModel } from '#lib/models.js';
import { negativeFor, pictureModel } from '../models';
import { putImage, readAsset } from '../assets';
import { imageRunRecord, putRun } from '../runs';
import type { DrawingStyle } from '../styles';
import { slot, slotKey, slotKeyOf, type ScopeKind, type SlotRef } from './ids';
import { engine } from './engine';
import type { Inputs, Pipeline, PipelineState, Stage, StepRun } from './registry';

/**
 * The pipeline characters and locations share:
 *
 *   your notes (and a character's role) → profile → designs → design
 *   pictures → reference → sheet
 *
 * The profile is written by the AI from the user's notes; the designs from
 * the "look" fields of the profile; each design is drawn as a picture; the
 * user chooses one picture as the reference (the AI never redraws it); the
 * sheet redraws the reference from other angles. The domain supplies its
 * data (profile fields, look fields, sheet views, picture size), its text
 * jobs and its prompts.
 */

export interface EntityState extends PipelineState {
	series: Series;
	/** The series' style, ready or not: the AI's context for the setting. */
	context: DrawingStyle | undefined;
	/** The series' style once it can draw (it has a prompt and a sample). */
	ready: DrawingStyle | undefined;
	/** The entity's name, as on its row. */
	name: string;
	/** The entity's own seed: design n is first drawn with seed + n. */
	seed: number;
}

export const ENTITY_STAGES = ['profile', 'designs', 'pictures', 'sheet'] as const;
export type EntityStage = (typeof ENTITY_STAGES)[number];

export interface EntityConfig<S extends EntityState> {
	domain: Extract<ScopeKind, 'character' | 'location'>;
	load(db: Db, id: number): S | undefined;
	error(message: string): Error;
	labels: Record<string, string>;
	/** The fields the AI writes into the profile. */
	profileKinds: readonly string[];
	/** The profile fields the designs are drawn from: what it is, its appearance, then the rest. */
	lookKinds: readonly [what: string, appearance: string, rest: string];
	/** What the profile is written from. */
	profileInputs(s: S): Inputs;
	designKeys: readonly string[];
	sheetViews: readonly string[];
	pictureSize: { width: number; height: number };
	/** Write profile fields (job `${domain}.develop`). */
	develop: StepRun<S>;
	/** Write designs (job `${domain}.designs`). */
	designs: StepRun<S>;
	/** After the profile is written. */
	afterDevelop?(db: Db, s: S, slots: SlotRef[]): void;
	/** The image prompt for one design's picture; throws if the design is missing. */
	picturePrompt(s: S & { ready: DrawingStyle }, key: string, guidance: string): string;
	/** The edit instruction for one sheet view. */
	sheetPrompt(colorMode: ColorMode, view: string, guidance: string, what: string): string;
}

export const textOf = (s: Pick<PipelineState, 'current'>, key: string) =>
	s.current.get(key)?.text ?? '';

/** The model chosen when a picture was asked for; for older pending ones, the series'. */
const modelOf = (db: Db, s: EntityState, version: Version) =>
	isImageModel(version.model) ? version.model : pictureModel(db, s.series);

export function entityPipeline<S extends EntityState>(config: EntityConfig<S>) {
	const { domain, lookKinds, designKeys } = config;
	const [what, appearance] = lookKinds;
	const looks = lookKinds.map((k) => slot(k));

	const lookInputs = (s: S): Inputs => ({
		brief: textOf(s, 'brief'),
		...Object.fromEntries(lookKinds.map((k) => [k, textOf(s, k)]))
	});
	const styleInputs = (s: S): Inputs => ({
		style: String(s.ready?.promptVersionId ?? ''),
		color: s.ready?.colorMode ?? ''
	});
	const designOf = (ref: SlotRef) => slot('design', ref.key);

	const profile: Stage<S> = {
		id: 'profile',
		kind: 'ai-text',
		kinds: config.profileKinds,
		slots: () => config.profileKinds.map((k) => slot(k)),
		inputs: (s) => config.profileInputs(s),
		upstream: () => [],
		ready: (s) => Boolean(textOf(s, 'brief') || s.name),
		job: { kind: `${domain}.develop`, per: 'stage', run: config.develop },
		afterFinish: config.afterDevelop
	};

	const designs: Stage<S> = {
		id: 'designs',
		kind: 'ai-text',
		kinds: ['design'],
		slots: () => designKeys.map((k) => slot('design', k)),
		inputs: lookInputs,
		upstream: () => looks,
		ready: (s) => Boolean(s.context && textOf(s, appearance)),
		job: { kind: `${domain}.designs`, per: 'stage', run: config.designs }
	};

	/**
	 * Design pictures. Each keeps the seed of its current version when its
	 * design or the style changed, so the new picture shows what the change
	 * did; redrawing an up-to-date picture uses a new seed.
	 */
	const pictures: Stage<S> = {
		id: 'pictures',
		kind: 'ai-image',
		kinds: ['picture'],
		slots: (s) =>
			designKeys
				.filter((k) => s.current.get(slotKeyOf('design', k)))
				.map((k) => slot('picture', k)),
		inputs: (s, ref) => ({
			design: textOf(s, slotKey(designOf(ref))),
			[what]: textOf(s, what),
			...styleInputs(s)
		}),
		upstream: (_s, ref) => [designOf(ref), slot(what)],
		ready: (s) => Boolean(s.ready),
		prepare: ({ db, state: s, slots, opts, snapshot }) =>
			slots.map((ref) => {
				const current = s.current.get(slotKey(ref));
				const outOfDate = snapshot().outOfDate(slotKey(ref)).length;
				const seed =
					opts.seed ??
					(current && !outOfDate
						? randomSeed()
						: (current?.seed ?? s.seed + designKeys.indexOf(ref.key ?? '')));
				return { seed, guidance: opts.guidance, model: pictureModel(db, s.series, opts.model) };
			}),
		job: {
			kind: `${domain}.picture`,
			per: 'slot',
			run: async ({ db, ai, signal, state: s, slots: [{ ref, version }] }) => {
				if (!s.ready) throw new Error('The series’ style is not ready.');
				const prompt = config.picturePrompt(
					s as S & { ready: DrawingStyle },
					ref.key ?? '',
					version!.guidance
				);
				const model = modelOf(db, s, version!);
				const seed = version!.seed ?? 0;
				const request = { prompt, negative: negativeFor(model, s.series), ...config.pictureSize };
				const result = await ai.image.generate({ model, seed, ...request }, signal);
				const { hash, thumbHash } = await putImage(db, result.png);
				const runHash = await putRun(db, imageRunRecord(result, seed, request));
				return new Map([
					[slotKey(ref), { text: prompt, assetHash: hash, thumbHash, model: result.model, runHash }]
				]);
			}
		}
	};

	/**
	 * The reference: the user's choice of a design picture. The AI never
	 * redraws it, so once chosen it anchors the sheet, which always follows
	 * the reference in use.
	 */
	const reference: Stage<S> = {
		id: 'reference',
		kind: 'user',
		kinds: ['reference'],
		slots: () => [slot('reference')],
		inputs: (s) => ({ ...lookInputs(s), ...styleInputs(s) }),
		upstream: () => looks,
		anchored: (view) => Boolean(view?.currentId)
	};

	const sheet: Stage<S> = {
		id: 'sheet',
		kind: 'ai-image',
		kinds: ['sheet'],
		slots: () => config.sheetViews.map((v) => slot('sheet', v)),
		inputs: (s) => ({
			reference: String(s.current.get('reference')?.id ?? ''),
			color: s.context?.colorMode ?? ''
		}),
		upstream: () => [slot('reference')],
		ready: (s) => Boolean(s.ready && s.current.get('reference')?.assetHash),
		// A request draws its views with consecutive seeds; an update redraws
		// each view on its own, with the guidance it was last drawn with.
		prepare: ({ db, state: s, slots, opts }) => {
			const seed = opts.seed ?? randomSeed();
			return slots.map((ref, i) =>
				opts.advancing
					? {
							seed: randomSeed(),
							guidance: s.current.get(slotKey(ref))?.guidance ?? '',
							model: pictureModel(db, s.series)
						}
					: {
							seed: seed + i,
							guidance: opts.guidance,
							model: pictureModel(db, s.series, opts.model)
						}
			);
		},
		job: {
			kind: `${domain}.sheet`,
			per: 'slot',
			run: async ({ db, ai, signal, state: s, slots: [{ ref, version }] }) => {
				const ref0 = s.current.get('reference');
				if (!ref0?.assetHash) throw new Error('The reference picture is missing.');
				const colorMode = s.context?.colorMode ?? 'bw';
				const prompt = config.sheetPrompt(
					colorMode,
					ref.key ?? '',
					version!.guidance,
					textOf(s, what)
				);
				const model = modelOf(db, s, version!);
				const seed = version!.seed ?? 0;
				const negative = negativeFor(model, s.series);
				const result = await ai.image.edit(
					{ model, prompt, negative, images: [readAsset(ref0.assetHash)], seed },
					signal
				);
				const { hash, thumbHash } = await putImage(db, result.png);
				const runHash = await putRun(
					db,
					imageRunRecord(result, seed, { prompt, negative, images: [ref0.assetHash] })
				);
				return new Map([
					[slotKey(ref), { text: prompt, assetHash: hash, thumbHash, model: result.model, runHash }]
				]);
			}
		},
		cascades: false
	};

	const pipeline: Pipeline<S> = {
		domain,
		load: config.load,
		stages: [profile, designs, pictures, reference, sheet],
		labels: config.labels,
		error: config.error
	};
	return { ...engine(pipeline), lookInputs };
}
