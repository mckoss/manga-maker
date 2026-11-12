/**
 * A chapter's plot: the user's idea for it (the logline and notes), a story
 * structure, the story elements (goal, stakes, conflict, climax…), a beat
 * outline in the structure's shape, and the story editor's review of it.
 *
 * Everything is a versioned item scoped "chapter:<id>", made in the order
 * structure → elements → beats → review: each step is made from the ones
 * before it and goes out of date when they change. The user can edit any
 * part (which locks it) and the AI regenerates only what is unlocked.
 *
 * The four steps run on the pipeline engine (`./pipeline`). What is plot's
 * own: the beats' fan-out follows the chosen structure (and the review is
 * made from those beats), so beats of a structure chosen earlier stay in the
 * scope as orphans; each step waits on gates beyond its upstream (the idea,
 * the structure, every element written, every beat made); only a kept item
 * anchors what follows; and the questions → answers → notes "clarify" flow
 * runs beside the engine (see "Clarify").
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import {
	chapterCast,
	chapters,
	characters,
	items,
	locations,
	series,
	type Chapter,
	type Item,
	type Series,
	type Version,
	versions
} from './db/schema';
import { enqueue, type JobHandler } from './jobs';
import { putRun } from './runs';
import { askJson } from './prompts/ask';
import { touchSeries } from './series';
import { drawingStyle, type DrawingStyle } from './styles';
import { characterScope, createCharacter, isRole, ROLES, type Role } from './characters';
import { defaultLocationId } from './locations';
import { ChapterError, chapterName, ownedChapter } from './chapters';
import {
	addVersion,
	attachJob,
	abandonVersion,
	currentVersions,
	dropPending,
	finishVersion,
	startVersion,
	VersionError,
	type Access,
	type ItemView
} from './versions';
import {
	DEFAULT_PAGE_TARGET,
	ELEMENT_KINDS,
	ELEMENTS,
	isElementKind,
	isStructure,
	STRUCTURES,
	type ElementKind,
	type StructureKey
} from '#lib/structures.js';
import { parseSlot, scopeOf, slot, slotKey, slotKeyOf, type SlotRef } from './pipeline/ids';
import { engine } from './pipeline/engine';
import type { PipelineState, Stage, Status, StepRun } from './pipeline/registry';

export class PlotError extends Error {}

export const chapterScope = scopeOf.chapter;

export const PLOT_STAGES = ['structure', 'elements', 'beats', 'review'] as const;
export type PlotStage = (typeof PLOT_STAGES)[number];

export function isPlotStage(value: string): value is PlotStage {
	return (PLOT_STAGES as readonly string[]).includes(value);
}

/**
 * Where an item stands: missing, pending, outdated (made from inputs that
 * changed), upstream (an earlier step it is made from will change), or ok.
 */
export type { Status };

/**
 * A beat of the outline: what happens, how many pages it gets, and who is in
 * it (series character ids). The chapter's cast is everyone in its beats.
 */
export interface BeatText {
	text: string;
	pages: number;
	characters: number[];
}

export function parseBeat(text: string | undefined): BeatText | null {
	if (!text) return null;
	try {
		const b = JSON.parse(text) as Partial<BeatText>;
		return {
			text: String(b.text ?? ''),
			pages: Number(b.pages) || 0,
			characters: Array.isArray(b.characters) ? b.characters.map(Number).filter(Boolean) : []
		};
	} catch {
		return null;
	}
}

const beatText = (b: BeatText) =>
	JSON.stringify({ text: b.text, pages: b.pages, characters: b.characters });

/** One of the story editor's notes on the outline. */
export interface ReviewNote {
	kind: 'strength' | 'issue';
	text: string;
}

export function parseReview(text: string | undefined): ReviewNote[] {
	try {
		return z.array(reviewNote).parse(JSON.parse(text ?? '[]'));
	} catch {
		return [];
	}
}

const question = z.object({
	question: z.string(),
	suggestions: z.array(z.string()).default([])
});
export type Question = z.infer<typeof question>;

function parseQuestions(text: string | undefined): Question[] {
	try {
		return z.array(question).parse(JSON.parse(text ?? '[]'));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// State

interface CastMember {
	id: number;
	name: string;
	role: string;
	personality: string;
	motivation: string;
	look: string;
}

interface PlotState extends PipelineState {
	chapter: Chapter;
	series: Series;
	style: DrawingStyle | undefined;
	/** Every character in the series. */
	people: CastMember[];
	/** The chapter's cast: everyone in its beats (ids). */
	cast: Set<number>;
	places: { name: string; setting: string; isDefault: boolean }[];
	/** Earlier chapters' endings, for continuity. */
	previous: { name: string; logline: string; ending: string }[];
}

function stateOf(db: Db, chapter: Chapter, owner: Series): PlotState {
	const people = db
		.select()
		.from(characters)
		.where(eq(characters.seriesId, owner.id))
		.orderBy(asc(characters.id))
		.all()
		.map((c) => {
			const cur = currentVersions(db, characterScope(c.id));
			const t = (k: string) => cur.get(k)?.text ?? '';
			return {
				id: c.id,
				name: c.name || t('name') || 'Unnamed',
				role: ROLES[c.role as Role] ?? c.role,
				personality: t('personality'),
				motivation: t('motivation'),
				look: t('appearance') || t('brief')
			};
		});
	const cast = new Set(
		db
			.select({ id: chapterCast.characterId })
			.from(chapterCast)
			.where(eq(chapterCast.chapterId, chapter.id))
			.all()
			.map((r) => r.id)
	);
	const fallback = defaultLocationId(db, owner);
	const places = db
		.select()
		.from(locations)
		.where(eq(locations.seriesId, owner.id))
		.orderBy(asc(locations.id))
		.all()
		.map((l) => {
			const cur = currentVersions(db, scopeOf.location(l.id));
			return {
				name: l.name || cur.get('name')?.text || 'Unnamed place',
				setting: cur.get('setting')?.text ?? '',
				isDefault: l.id === fallback
			};
		});
	const previous = db
		.select()
		.from(chapters)
		.where(and(eq(chapters.seriesId, owner.id), lt(chapters.number, chapter.number)))
		.orderBy(asc(chapters.number))
		.all()
		.map((c) => {
			const cur = currentVersions(db, chapterScope(c.id));
			const ending = [cur.get('resolution')?.text, cur.get('ending')?.text]
				.filter(Boolean)
				.join(' ');
			return { name: chapterName(c), logline: c.logline, ending };
		});
	const scope = chapterScope(chapter.id);
	return {
		id: chapter.id,
		ownerId: owner.ownerId,
		scope,
		chapter,
		series: owner,
		style: owner.styleId ? drawingStyle(db, owner.styleId) : undefined,
		current: currentVersions(db, scope),
		people,
		cast,
		places,
		previous
	};
}

const textOf = (s: PlotState, key: string) => s.current.get(key)?.text ?? '';

/** The structure in use: the one chosen, or none yet. */
function structureOf(s: PlotState): StructureKey | null {
	const key = textOf(s, 'structure');
	return isStructure(key) ? key : null;
}

const beatKeys = (s: PlotState) => {
	const key = structureOf(s);
	return key ? STRUCTURES[key].beats.map((b) => b.key) : [];
};

/** A beat's slot ("beat:hook"), and its slot key. */
const beatSlot = (key: string) => slot('beat', key);
const beatSlotKey = (key: string) => slotKeyOf('beat', key);

/** The beats of the structure in use; beats of one chosen earlier are left out. */
const beatSlots = (s: PlotState) => beatKeys(s).map(beatSlot);

const structureSlot = slot('structure');
const elementSlots = ELEMENT_KINDS.map((k) => slot(k));
const reviewSlot = slot('review');

/** A short fingerprint of long text, so inputs stay small. */
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const ideaInputs = (s: PlotState) => ({
	logline: s.chapter.logline,
	notes: textOf(s, 'notes')
});

const structureInputs = ideaInputs;

const elementInputs = (s: PlotState) => ({
	...ideaInputs(s),
	structure: textOf(s, 'structure')
});

const elementsDigest = (s: PlotState) =>
	digest(ELEMENT_KINDS.map((k) => `${k}=${textOf(s, k)}`).join('\n'));

const beatInputs = (s: PlotState) => ({
	structure: textOf(s, 'structure'),
	elements: elementsDigest(s),
	pages: String(s.chapter.pageTarget)
});

const reviewInputs = (s: PlotState) => ({
	elements: elementsDigest(s),
	beats: digest(
		beatKeys(s)
			.map((k) => `${k}=${textOf(s, beatSlotKey(k))}`)
			.join('\n')
	)
});

// ---------------------------------------------------------------------------
// The pipeline

/** The gates each step waits on, beyond the steps it is made from being settled. */
const hasIdea = (s: PlotState) => Boolean(s.chapter.logline || textOf(s, 'notes'));
const canWriteElements = (s: PlotState) => hasIdea(s) && Boolean(structureOf(s));
const canWriteBeats = (s: PlotState) =>
	canWriteElements(s) && ELEMENT_KINDS.every((k) => textOf(s, k));
const canReview = (s: PlotState) =>
	canWriteBeats(s) && beatSlots(s).every((ref) => s.current.get(slotKey(ref)));

const structureStage: Stage<PlotState> = {
	id: 'structure',
	kind: 'ai-text',
	kinds: ['structure'],
	slots: () => [structureSlot],
	inputs: structureInputs,
	upstream: () => [],
	ready: hasIdea,
	job: { kind: 'plot.structure', per: 'stage', run: (ctx) => structureRun(ctx) }
};

const elementsStage: Stage<PlotState> = {
	id: 'elements',
	kind: 'ai-text',
	kinds: ELEMENT_KINDS,
	slots: () => elementSlots,
	inputs: elementInputs,
	upstream: () => [structureSlot],
	ready: canWriteElements,
	job: { kind: 'plot.elements', per: 'stage', run: (ctx) => elementsRun(ctx) }
};

/**
 * The beats of the structure in use. A job's payload names them by slot
 * ("beat:hook"), as it always has; the cast follows the beats once written.
 */
const beatsStage: Stage<PlotState> = {
	id: 'beats',
	kind: 'ai-text',
	kinds: ['beat'],
	slots: beatSlots,
	inputs: beatInputs,
	upstream: () => [structureSlot, ...elementSlots],
	ready: canWriteBeats,
	job: { kind: 'plot.beats', per: 'stage', payloadKeys: 'slot', run: (ctx) => beatsRun(ctx) },
	afterFinish: (db, s) => syncCast(db, s.id)
};

const reviewStage: Stage<PlotState> = {
	id: 'review',
	kind: 'ai-text',
	kinds: ['review'],
	slots: () => [reviewSlot],
	inputs: reviewInputs,
	upstream: beatSlots,
	ready: canReview,
	job: { kind: 'plot.review', per: 'stage', run: (ctx) => reviewRun(ctx) }
};

/** What each kind of input is called when saying why something is out of date. */
const INPUT_LABELS: Record<string, string> = {
	logline: 'the logline',
	notes: 'your notes',
	structure: 'the structure',
	elements: 'the story elements',
	pages: 'the page target',
	beats: 'the beats'
};

const flow = engine<PlotState>({
	domain: 'chapter',
	load: loadState,
	stages: [structureStage, elementsStage, beatsStage, reviewStage],
	labels: INPUT_LABELS,
	// The questions are made by the clarify flow, beside the engine.
	inputsOutside: (s, ref) => (ref.kind === 'questions' ? ideaInputs(s) : null),
	error: (message) => new PlotError(message)
});

// ---------------------------------------------------------------------------
// Queries

function ownedState(db: Db, ownerId: number, seriesId: number, chapterId: number): PlotState {
	const chapter = ownedChapter(db, ownerId, seriesId, chapterId);
	const owner = db.select().from(series).where(eq(series.id, seriesId)).get()!;
	return stateOf(db, chapter, owner);
}

function loadState(db: Db, chapterId: number): PlotState | undefined {
	const row = db
		.select({ chapter: chapters, series })
		.from(chapters)
		.innerJoin(series, eq(chapters.seriesId, series.id))
		.where(eq(chapters.id, chapterId))
		.get();
	return row ? stateOf(db, row.chapter, row.series) : undefined;
}

/** Who may change a chapter's items. */
export function plotAccess(db: Db, ownerId: number, seriesId: number, chapterId: number): Access {
	ownedChapter(db, ownerId, seriesId, chapterId);
	return { ownerId, scope: chapterScope(chapterId) };
}

const emptyView = (kind: string, key = ''): ItemView => ({
	id: 0,
	kind,
	key,
	locked: false,
	versions: [],
	currentId: null,
	pending: false,
	error: null
});

export function getPlot(db: Db, ownerId: number, seriesId: number, chapterId: number) {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	const snap = flow.describe(db, s, INPUT_LABELS);
	const { views, status } = snap;
	const view = (key: string) => {
		const ref = parseSlot(key);
		return views.get(key) ?? emptyView(ref.kind, ref.key ?? '');
	};
	const structure = structureOf(s);
	const structureItem = view('structure');
	const questions = view('questions');
	const beats = structure
		? STRUCTURES[structure].beats.map((b) => {
				const key = beatSlotKey(b.key);
				return { ...b, item: view(key), status: status(key), value: parseBeat(textOf(s, key)) };
			})
		: [];
	const review = view('review');
	const summary = (keys: string[]) => {
		const of = (want: Status[]) => keys.filter((key) => want.includes(status(key)));
		return {
			total: keys.length,
			pending: of(['pending']).length,
			missing: of(['missing']).length,
			stale: of(['outdated', 'upstream']).filter((key) => !views.get(key)?.locked).length,
			kept: keys.filter((key) => views.get(key)?.locked).length
		};
	};
	const due = Object.fromEntries(
		PLOT_STAGES.map((st) => [st, flow.dueSlots(s, st, snap).length])
	) as Record<PlotStage, number>;
	const beatKeysInUse = beatSlots(s).map(slotKey);
	// The AI's latest notes on the elements.
	const elementNotes =
		ELEMENT_KINDS.map((k) => s.current.get(k))
			.filter((v): v is Version => Boolean(v?.notes))
			.sort((a, b) => b.id - a.id)[0]?.notes ?? '';
	return {
		pageTarget: s.chapter.pageTarget,
		hasIdea: hasIdea(s),
		/** Every series character, for the beats' character lists. */
		people: s.people.map((c) => ({ id: c.id, name: c.name, role: c.role })),
		cast: s.people.filter((c) => s.cast.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
		notes: view('notes'),
		questions: { item: questions, list: openQuestions(questions) },
		structure: {
			key: structure,
			item: structureItem,
			status: status('structure'),
			/** The AI's reason for its suggestion, when the current choice is the AI's. */
			reason:
				structureItem.versions.find((v) => v.id === structureItem.currentId)?.origin === 'ai'
					? (s.current.get('structure')?.notes ?? '')
					: '',
			suggested: (() => {
				const ai = structureItem.versions.findLast((v) => v.origin === 'ai');
				return ai && isStructure(ai.text) ? ai.text : null;
			})()
		},
		elements: ELEMENTS.map((e) => ({ ...e, item: view(e.kind), status: status(e.kind) })),
		elementNotes,
		/** The AI's latest notes on the beats. */
		beatNotes:
			beatKeysInUse
				.map((key) => s.current.get(key))
				.filter((v): v is Version => Boolean(v?.notes))
				.sort((a, b) => b.id - a.id)[0]?.notes ?? '',
		beats,
		pagesPlanned: beats.reduce((n, b) => n + (b.value?.pages ?? 0), 0),
		review: { item: review, status: status('review'), notes: parseReview(textOf(s, 'review')) },
		due,
		flow: {
			idea: {
				total: 1,
				pending: 0,
				missing: hasIdea(s) ? 0 : 1,
				stale: 0,
				kept: 0
			},
			structure: summary(['structure']),
			elements: summary([...ELEMENT_KINDS]),
			beats: summary(beatKeysInUse),
			review: summary(['review'])
		},
		// Orphaned beats (of a structure chosen earlier) count too.
		busy: [...views.values()].some((v) => v.pending)
	};
}

export type PlotDetail = ReturnType<typeof getPlot>;

// ---------------------------------------------------------------------------
// Commands

/** Turn a VersionError into a PlotError the page shows. */
function run<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof VersionError) throw new PlotError(e.message);
		throw e;
	}
}

const item = (db: Db, s: PlotState, ref: SlotRef) => flow.item(db, s, ref);

/** Set a new version of the user's own text, or only the lock when the text is unchanged. */
function saveOwn(db: Db, s: PlotState, it: Item, text: string, keep: boolean, generated: boolean) {
	const ref = slot(it.kind, it.key);
	const now = textOf(s, slotKey(ref));
	if (text === now) {
		if (generated && it.currentVersionId !== null && it.locked !== keep) {
			db.update(items).set({ locked: keep }).where(eq(items.id, it.id)).run();
			if (keep) dropPending(db, [it.id]);
		}
		return;
	}
	run(() =>
		addVersion(
			db,
			it,
			{ origin: 'user', text, inputs: flow.inputsFor(s, ref) ?? {} },
			generated ? { keep } : {}
		)
	);
	touchSeries(db, s.series.id);
}

/** The user's notes on the chapter: their idea, in their own words. */
export function saveNotes(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	text: string
) {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	saveOwn(db, s, item(db, s, slot('notes')), text.trim(), false, false);
}

export function setPageTarget(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	pages: number
) {
	ownedChapter(db, ownerId, seriesId, chapterId);
	if (!Number.isInteger(pages) || pages < 1 || pages > 200) {
		throw new PlotError('The page target is a whole number from 1 to 200.');
	}
	db.update(chapters)
		.set({ pageTarget: pages, updatedAt: new Date() })
		.where(eq(chapters.id, chapterId))
		.run();
}

/** Choose the structure; the user's choice is locked, so the AI won't replace it. */
export function chooseStructure(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	key: string
) {
	if (!isStructure(key)) throw new PlotError('Choose one of the structures.');
	const s = ownedState(db, ownerId, seriesId, chapterId);
	const it = item(db, s, structureSlot);
	if (key === structureOf(s)) {
		if (!it.locked) db.update(items).set({ locked: true }).where(eq(items.id, it.id)).run();
		return;
	}
	run(() =>
		addVersion(db, it, { origin: 'user', text: key, inputs: structureInputs(s) }, { keep: true })
	);
	touchSeries(db, s.series.id);
}

export function saveElement(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	kind: string,
	text: string,
	keep = true
) {
	if (!isElementKind(kind)) throw new PlotError('Unknown story element.');
	const s = ownedState(db, ownerId, seriesId, chapterId);
	saveOwn(db, s, item(db, s, slot(kind)), text.trim(), keep, true);
}

export function saveBeat(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	key: string,
	beat: { text: string; pages: number; characters: number[]; newNames?: string[] },
	keep = true
) {
	let s = ownedState(db, ownerId, seriesId, chapterId);
	if (!beatKeys(s).includes(key)) throw new PlotError('Unknown beat.');
	const text = beat.text.trim();
	if (!text) throw new PlotError('Say what happens in this beat.');
	const pages = Math.max(0, Math.round(beat.pages || 0));
	const valid = new Set(s.people.map((c) => c.id));
	const characters = beat.characters.filter((id) => valid.has(id));
	const names = (beat.newNames ?? []).map((n) => n.trim()).filter(Boolean);
	if (names.length) {
		const { ids } = resolveCharacters(db, s, [{ characters: names, text }], []);
		characters.push(...ids[0]!);
		s = ownedState(db, ownerId, seriesId, chapterId);
	}
	const unique = [...new Set(characters)];
	saveOwn(
		db,
		s,
		item(db, s, beatSlot(key)),
		beatText({ text, pages, characters: unique }),
		keep,
		true
	);
	syncCast(db, chapterId);
}

/**
 * Generate what is missing and regenerate what is out of date and unlocked,
 * step by step: each job carries the later steps on once it finishes.
 */
export function updatePlot(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	stages: readonly PlotStage[] = PLOT_STAGES
): number {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	if (!hasIdea(s)) {
		throw new PlotError('Write the logline or your notes first.');
	}
	return flow.advance(db, chapterId, stages);
}

/**
 * Regenerate one stage (or one item of it, `only` being its slot key:
 * "structure", an element's kind, "beat:<key>" or "review") on request,
 * with the user's guidance; what comes after is carried on.
 */
export function requestStage(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	stage: PlotStage,
	opts: { only?: string; guidance?: string } = {}
): number {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	const { views } = flow.describe(db, s);
	const all =
		stage === 'structure'
			? [structureSlot]
			: stage === 'elements'
				? elementSlots
				: stage === 'beats'
					? beatSlots(s)
					: [reviewSlot];
	if (stage !== 'structure' && !structureOf(s)) throw new PlotError('Choose a structure first.');
	if ((stage === 'beats' || stage === 'review') && ELEMENT_KINDS.some((k) => !textOf(s, k))) {
		throw new PlotError('Write the story elements first.');
	}
	const slots = (opts.only ? all.filter((ref) => slotKey(ref) === opts.only) : all).filter(
		(ref) => !views.get(slotKey(ref))?.locked
	);
	if (!slots.length) throw new PlotError('It is locked. Unlock it to regenerate it.');
	const cascade = PLOT_STAGES.slice(PLOT_STAGES.indexOf(stage) + 1);
	return flow.start(db, s, stage, slots, { guidance: opts.guidance, cascade });
}

// ---------------------------------------------------------------------------
// Clarify
//
// Before the plot is written, the story editor can ask what the idea leaves
// open: `requestQuestions` makes a "questions" item (job `plot.questions`)
// from the logline and notes; `answerQuestions` starts a new version of the
// user's notes with the answers as its guidance, which the AI folds in (job
// `plot.fold`), and then puts the questions away with an empty user version
// ("[]"); `skipQuestions` puts them away unanswered. Questions about notes
// that have changed since are out of date and not shown.
//
// This runs beside the engine, not as a stage: nothing is made from the
// questions, the fold writes the user's own notes, and neither cascades.
// Styles have the same flow (on their description); it differs in details
// (a kept questions item is skipped there rather than refused, and asking
// needs no idea), so each domain keeps its own (see PLAN.md).

/** The questions not yet answered or skipped: none while new ones are asked or the idea changed. */
function openQuestions(questions: ItemView): Question[] {
	const cur = questions.versions.find((v) => v.id === questions.currentId);
	if (!cur || cur.outOfDate.length || questions.pending) return [];
	return parseQuestions(cur.text);
}

/** Ask the story editor what the idea leaves open. */
export function requestQuestions(db: Db, ownerId: number, seriesId: number, chapterId: number) {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	if (!hasIdea(s)) {
		throw new PlotError('Write the logline or your notes first.');
	}
	const it = item(db, s, slot('questions'));
	const version = run(() => startVersion(db, it));
	const job = enqueue(db, ownerId, 'plot.questions', {
		chapterId,
		versionId: version.id
	});
	attachJob(db, [version.id], job.id);
}

/** Have the AI fold the user's answers into a new version of their notes. */
export function answerQuestions(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	answers: string[]
) {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	const asked = parseQuestions(textOf(s, 'questions'));
	const answered = asked
		.map((q, i) => ({ question: q.question, answer: answers[i]?.trim() ?? '' }))
		.filter((qa) => qa.answer);
	if (!answered.length) throw new PlotError('Answer at least one question, or skip them.');
	const version = run(() =>
		startVersion(db, item(db, s, slot('notes')), {
			guidance: answered.map((qa) => `${qa.question} ${qa.answer}`).join('\n')
		})
	);
	const job = enqueue(db, ownerId, 'plot.fold', { chapterId, versionId: version.id });
	attachJob(db, [version.id], job.id);
}

export function skipQuestions(db: Db, ownerId: number, seriesId: number, chapterId: number) {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	run(() =>
		addVersion(db, item(db, s, slot('questions')), {
			origin: 'user',
			text: '[]',
			inputs: ideaInputs(s)
		})
	);
}

// ---------------------------------------------------------------------------
// What the AI is asked (its system prompts are in prompts/plot.ts)

/** What the AI knows about the series and chapter, for every request. */
export function storyContext(s: PlotState): string[] {
	const lines = [`Series: ${s.series.title}`];
	if (s.series.logline) lines.push(`Series logline: ${s.series.logline}`);
	if (s.style?.description) lines.push(`The series' setting and look: ${s.style.description}`);
	for (const p of s.previous) {
		lines.push(
			`Earlier, ${p.name}: ${p.logline || '(no logline)'}${p.ending ? ` It ended: ${p.ending}` : ''}`
		);
	}
	lines.push(`This chapter: ${chapterName(s.chapter)} (chapter ${s.chapter.number})`);
	if (s.chapter.logline) lines.push(`Chapter logline: ${s.chapter.logline}`);
	const notes = textOf(s, 'notes');
	if (notes) lines.push(`The writer's notes on this chapter: ${notes}`);
	lines.push(`Length: about ${s.chapter.pageTarget} pages.`);
	if (s.people.length) {
		lines.push(
			'Characters in the series (use them by these names; * marks those already in this chapter):',
			...s.people.map((c) =>
				[
					`- ${c.name}${s.cast.has(c.id) ? ' *' : ''} (${c.role})`,
					c.personality && `personality: ${c.personality}`,
					c.motivation && `wants: ${c.motivation}`,
					c.look && `looks: ${c.look}`
				]
					.filter(Boolean)
					.join('; ')
			)
		);
	} else {
		lines.push('The series has no characters yet: name the ones the story needs.');
	}
	if (s.places.length) {
		lines.push(
			'Places in the series:',
			...s.places.map(
				(p) => `- ${p.name}${p.isDefault ? ' (the main location)' : ''}: ${p.setting}`
			)
		);
	}
	return lines;
}

/** `storyContext` for a chapter by id, for steps beside the plot (the script's help). */
export function chapterContext(db: Db, chapterId: number): string[] {
	const s = loadState(db, chapterId);
	return s ? storyContext(s) : [];
}

const structureReply = z.object({ structure: z.string(), reason: z.string().default('') });

export function structureMessages(s: PlotState, guidance: string) {
	const lines = storyContext(s);
	if (guidance) lines.push(`The writer's feedback: ${guidance}`);
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

const elementFields = Object.fromEntries(
	ELEMENT_KINDS.map((k) => [k, z.string().default('')])
) as Record<ElementKind, z.ZodDefault<z.ZodString>>;

const newCharacter = z.object({
	name: z.string(),
	role: z.string().default('supporting'),
	brief: z.string().default('')
});

const elementsReply = z.object({ ...elementFields, notes: z.string().default('') });

export function elementsMessages(s: PlotState, rewrite: ElementKind[], guidance: string) {
	const key = structureOf(s)!;
	const lines = storyContext(s);
	lines.push(
		`Structure: ${STRUCTURES[key].label}: ${STRUCTURES[key].beats.map((b) => `${b.label} (${b.hint})`).join('; ')}`
	);
	const kept = ELEMENT_KINDS.filter((k) => !rewrite.includes(k) && textOf(s, k));
	if (kept.length) {
		lines.push('Kept (repeat exactly):', ...kept.map((k) => `- ${k}: ${textOf(s, k)}`));
	}
	const previous = rewrite.filter((k) => textOf(s, k));
	if (previous.length && guidance) {
		lines.push(
			'The current draft of the elements to rewrite:',
			...previous.map((k) => `- ${k}: ${textOf(s, k)}`)
		);
	}
	lines.push(
		guidance ? `The writer's feedback: ${guidance}` : `Write these elements: ${rewrite.join(', ')}.`
	);
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

const beatsReply = z.object({
	beats: z
		.array(
			z.object({
				key: z.string(),
				text: z.string(),
				pages: z.coerce.number().default(1),
				characters: z.array(z.string()).default([])
			})
		)
		.default([]),
	notes: z.string().default(''),
	newCharacters: z.array(newCharacter).default([])
});

export function beatsMessages(s: PlotState, rewrite: string[], guidance: string) {
	const key = structureOf(s)!;
	const lines = storyContext(s);
	lines.push(
		`Structure: ${STRUCTURES[key].label}`,
		'Story elements:',
		...ELEMENTS.map((e) => `- ${e.label}: ${textOf(s, e.kind)}`),
		'The beats (key: name: what it is for):',
		...STRUCTURES[key].beats.map((b) => `- ${b.key}: ${b.label}: ${b.hint}`)
	);
	const kept = beatKeys(s).filter((k) => !rewrite.includes(k) && textOf(s, beatSlotKey(k)));
	if (kept.length) {
		lines.push(
			'Kept beats (fit around these; do not repeat them):',
			...kept.map((k) => {
				const b = parseBeat(textOf(s, beatSlotKey(k)));
				return `- ${k} (${b?.pages ?? 0} pages; ${namesOf(s, b?.characters ?? []) || 'nobody'}): ${b?.text ?? ''}`;
			})
		);
	}
	if (guidance) {
		const previous = rewrite.filter((k) => textOf(s, beatSlotKey(k)));
		if (previous.length) {
			lines.push(
				'The current draft of the beats to rewrite:',
				...previous.map((k) => `- ${k}: ${parseBeat(textOf(s, beatSlotKey(k)))?.text ?? ''}`)
			);
		}
		lines.push(`The writer's feedback: ${guidance}`);
	}
	lines.push(`Beats to write: ${rewrite.join(', ')}`);
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

const reviewNote = z.object({ kind: z.enum(['strength', 'issue']), text: z.string() });
const reviewReply = z.object({ notes: z.array(reviewNote).default([]) });

export function reviewMessages(s: PlotState, guidance: string) {
	const key = structureOf(s)!;
	const lines = storyContext(s);
	lines.push(
		`Structure: ${STRUCTURES[key].label}`,
		'Story elements:',
		...ELEMENTS.map((e) => `- ${e.label}: ${textOf(s, e.kind)}`),
		'Outline:',
		...STRUCTURES[key].beats.map((b) => {
			const beat = parseBeat(textOf(s, beatSlotKey(b.key)));
			return `- ${b.label} (${beat?.pages ?? 0} pages): ${beat?.text ?? ''}`;
		})
	);
	if (guidance) lines.push(`The writer asks you to look at: ${guidance}`);
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

const questionsReply = z.object({ questions: z.array(question).max(6).default([]) });

const foldReply = z.object({ notes: z.string().min(1) });

// ---------------------------------------------------------------------------
// Jobs

const namesOf = (s: PlotState, ids: number[]) =>
	ids
		.map((id) => s.people.find((c) => c.id === id)?.name)
		.filter(Boolean)
		.join(', ');

/**
 * Series character ids for the names the AI's beats use. A name not yet in
 * the series becomes a new character, named and described but not
 * developed, so the Characters page lists it with what is left to do.
 */
function resolveCharacters(
	db: Db,
	s: PlotState,
	beats: { characters: string[]; text: string }[],
	described: z.infer<typeof newCharacter>[]
): { ids: number[][]; created: string[] } {
	const known = new Map(s.people.map((c) => [c.name.trim().toLowerCase(), c.id] as const));
	const created: string[] = [];
	const idOf = (raw: string, context: string): number | undefined => {
		const name = raw.trim();
		if (!name) return undefined;
		const found = known.get(name.toLowerCase());
		if (found) return found;
		if (created.length >= 6) return undefined;
		const d = described.find((n) => n.name.trim().toLowerCase() === name.toLowerCase());
		const role = d?.role.trim().toLowerCase() ?? '';
		const id = createCharacter(
			db,
			s.series.ownerId,
			s.series.id,
			{
				name,
				role: isRole(role) ? role : 'supporting',
				brief: `${d?.brief.trim() || context} (Introduced in the plot of ${chapterName(s.chapter)}.)`
			},
			undefined,
			false
		);
		known.set(name.toLowerCase(), id);
		created.push(name);
		return id;
	};
	const ids = beats.map((b) => [
		...new Set(b.characters.map((n) => idOf(n, b.text)).filter((id): id is number => !!id))
	]);
	return { ids, created };
}

/**
 * The chapter's cast is everyone in its beats: add those missing, and drop
 * those no beat has any more. Without beats yet, the cast is left as it is.
 */
export function syncCast(db: Db, chapterId: number): void {
	const s = loadState(db, chapterId);
	if (!s) return;
	const beats = beatKeys(s)
		.map((k) => parseBeat(textOf(s, beatSlotKey(k))))
		.filter((b): b is BeatText => b !== null);
	if (!beats.length) return;
	const wanted = new Set(beats.flatMap((b) => b.characters));
	const now = new Date();
	for (const id of wanted) {
		if (!s.cast.has(id) && s.people.some((c) => c.id === id)) {
			db.insert(chapterCast).values({ chapterId, characterId: id, createdAt: now }).run();
		}
	}
	for (const id of s.cast) {
		if (!wanted.has(id)) {
			db.delete(chapterCast)
				.where(and(eq(chapterCast.chapterId, chapterId), eq(chapterCast.characterId, id)))
				.run();
		}
	}
}

/** The structure; nothing at all (no cascade) if its version was dropped meanwhile. */
const structureRun: StepRun<PlotState> = async ({ db, ai, signal, state: s, slots, guidance }) => {
	if (!slots.some((x) => x.version?.status === 'pending')) return null;
	const {
		value: reply,
		prompt,
		run
	} = await askJson(ai, 'plot.structure', structureMessages(s, guidance), structureReply, signal);
	const runHash = await putRun(db, run);
	const key = reply.structure.trim();
	if (!isStructure(key)) throw new Error(`The AI chose an unknown structure: ${key}`);
	return new Map([
		[
			slotKey(structureSlot),
			{ text: key, notes: reply.reason.trim(), model: ai.text.name, ...prompt, runHash }
		]
	]);
};

/** The elements asked for; one the AI leaves empty is dropped. */
const elementsRun: StepRun<PlotState> = async ({ db, ai, signal, state: s, slots, guidance }) => {
	if (!structureOf(s)) return null;
	const rewrite = ELEMENT_KINDS.filter((k) => slots.some((x) => x.ref.kind === k));
	const {
		value: reply,
		prompt,
		run
	} = await askJson(
		ai,
		'plot.elements',
		elementsMessages(s, rewrite, guidance),
		elementsReply,
		signal
	);
	const runHash = await putRun(db, run);
	const notes = reply.notes.trim();
	return new Map(
		rewrite.map((kind) => {
			const text = reply[kind]?.trim();
			return [
				slotKeyOf(kind),
				text ? { text, notes, model: ai.text.name, ...prompt, runHash } : null
			];
		})
	);
};

/**
 * The beats asked for, of the structure in use: beats of a structure no
 * longer in use (chosen while the job waited) are dropped first, and if none
 * is left the job does nothing at all. Characters the beats name who are not
 * in the series yet are added to it; the cast follows (`afterFinish`).
 */
const beatsRun: StepRun<PlotState> = async ({ db, ai, signal, state: s, slots, guidance }) => {
	if (!structureOf(s)) return null;
	const rewrite = beatKeys(s).filter((k) => slots.some((x) => x.ref.key === k));
	for (const { ref, version } of slots) {
		if (version && !rewrite.includes(ref.key ?? '')) abandonVersion(db, version.id);
	}
	if (!rewrite.length) return null;
	const {
		value: reply,
		prompt,
		run
	} = await askJson(ai, 'plot.beats', beatsMessages(s, rewrite, guidance), beatsReply, signal);
	const runHash = await putRun(db, run);
	const written = rewrite.map((key) => reply.beats.find((x) => x.key.trim() === key));
	const { ids, created } = resolveCharacters(
		db,
		s,
		written.map((b) => ({ characters: b?.characters ?? [], text: b?.text ?? '' })),
		reply.newCharacters
	);
	const notes = [
		reply.notes.trim(),
		created.length && `New in the series, to develop on the Characters page: ${created.join(', ')}.`
	]
		.filter(Boolean)
		.join(' ');
	return new Map(
		rewrite.map((key, i) => {
			const b = written[i];
			return [
				beatSlotKey(key),
				b?.text.trim()
					? {
							text: beatText({
								text: b.text.trim(),
								pages: Math.max(0, Math.round(b.pages)),
								characters: ids[i]!
							}),
							notes,
							model: ai.text.name,
							...prompt,
							runHash
						}
					: null
			];
		})
	);
};

const reviewRun: StepRun<PlotState> = async ({ db, ai, signal, state: s, guidance }) => {
	if (!structureOf(s)) return null;
	const {
		value: reply,
		prompt,
		run
	} = await askJson(ai, 'plot.review', reviewMessages(s, guidance), reviewReply, signal);
	const runHash = await putRun(db, run);
	return new Map([
		[
			slotKey(reviewSlot),
			{ text: JSON.stringify(reply.notes.slice(0, 8)), model: ai.text.name, ...prompt, runHash }
		]
	]);
};

// The clarify flow's jobs (see "Clarify").

const questionsHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { chapterId, versionId } = job.payload as { chapterId: number; versionId: number };
	const s = loadState(db, chapterId);
	if (!s) return;
	const {
		value: reply,
		prompt,
		run
	} = await askJson(
		ai,
		'plot.questions',
		[{ role: 'user', content: storyContext(s).join('\n') }],
		questionsReply,
		signal
	);
	const runHash = await putRun(db, run);
	const list = reply.questions.slice(0, 4).map((q) => ({
		question: q.question.trim(),
		suggestions: q.suggestions
			.map((x) => x.trim())
			.filter(Boolean)
			.slice(0, 4)
	}));
	finishVersion(db, versionId, {
		text: JSON.stringify(list),
		inputs: ideaInputs(s),
		model: ai.text.name,
		...prompt,
		runHash
	});
};

const foldHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { chapterId, versionId } = job.payload as { chapterId: number; versionId: number };
	const s = loadState(db, chapterId);
	const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
	if (!s || version?.status !== 'pending') return;
	const {
		value: reply,
		prompt,
		run
	} = await askJson(
		ai,
		'plot.fold',
		[
			{
				role: 'user',
				content: [
					`The writer's chapter logline: ${s.chapter.logline}`,
					`The writer's notes: ${textOf(s, 'notes')}`,
					// The answers are kept as the guidance of the version folding them in.
					`Your questions and their answers:\n${version.guidance}`
				].join('\n')
			}
		],
		foldReply,
		signal
	);
	const runHash = await putRun(db, run);
	finishVersion(db, versionId, {
		text: reply.notes.trim(),
		notes: 'Your answers, folded into your notes.',
		model: ai.text.name,
		...prompt,
		runHash
	});
	// The questions were about the old notes; they are now answered.
	const now = loadState(db, chapterId)!;
	const questions = item(db, now, slot('questions'));
	if (!questions.locked) {
		addVersion(db, questions, { origin: 'user', text: '[]', inputs: ideaInputs(now) });
	}
};

export const plotJobHandlers: Record<string, JobHandler> = {
	...flow.handlers(),
	'plot.questions': questionsHandler,
	'plot.fold': foldHandler
};

export { ChapterError, DEFAULT_PAGE_TARGET };
