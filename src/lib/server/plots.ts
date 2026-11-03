/**
 * A chapter's plot: the user's idea for it (the logline and notes), a story
 * structure, the story elements (goal, stakes, conflict, climax…), a beat
 * outline in the structure's shape, and the story editor's review of it.
 *
 * Everything is a versioned item scoped "chapter:<id>", made in the order
 * structure → elements → beats → review: each step is made from the ones
 * before it and goes out of date when they change. The user can edit any
 * part (which locks it) and the AI regenerates only what is unlocked.
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
import { touchSeries } from './series';
import { drawingStyle, type DrawingStyle } from './styles';
import { characterScope, createCharacter, isRole, ROLES, type Role } from './characters';
import { defaultLocationId, locationScope } from './locations';
import { ChapterError, chapterName, ownedChapter } from './chapters';
import {
	addVersion,
	attachJob,
	abandonVersion,
	currentVersions,
	describeScope,
	dropPending,
	ensureItem,
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
	STRUCTURE_KEYS,
	STRUCTURES,
	type ElementKind,
	type StructureKey
} from '#lib/structures.js';

export class PlotError extends Error {}

export const chapterScope = (chapterId: number) => `chapter:${chapterId}`;

export const PLOT_STAGES = ['structure', 'elements', 'beats', 'review'] as const;
export type PlotStage = (typeof PLOT_STAGES)[number];

export function isPlotStage(value: string): value is PlotStage {
	return (PLOT_STAGES as readonly string[]).includes(value);
}

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

/** What each kind of input is called when saying why something is out of date. */
const INPUT_LABELS: Record<string, string> = {
	logline: 'the logline',
	notes: 'your notes',
	structure: 'the structure',
	elements: 'the story elements',
	pages: 'the page target',
	beats: 'the beats'
};

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

interface PlotState {
	chapter: Chapter;
	series: Series;
	style: DrawingStyle | undefined;
	current: Map<string, Version>;
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
			const cur = currentVersions(db, locationScope(l.id));
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
	return {
		chapter,
		series: owner,
		style: owner.styleId ? drawingStyle(db, owner.styleId) : undefined,
		current: currentVersions(db, chapterScope(chapter.id)),
		people,
		cast,
		places,
		previous
	};
}

const textOf = (s: PlotState, slot: string) => s.current.get(slot)?.text ?? '';

/** The structure in use: the one chosen, or none yet. */
function structureOf(s: PlotState): StructureKey | null {
	const key = textOf(s, 'structure');
	return isStructure(key) ? key : null;
}

const beatKeys = (s: PlotState) => {
	const key = structureOf(s);
	return key ? STRUCTURES[key].beats.map((b) => b.key) : [];
};

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
			.map((k) => `${k}=${textOf(s, `beat:${k}`)}`)
			.join('\n')
	)
});

function inputsFor(s: PlotState, item: Pick<Item, 'kind' | 'key'>) {
	if (item.kind === 'questions') return ideaInputs(s);
	if (item.kind === 'structure') return structureInputs(s);
	if (isElementKind(item.kind)) return elementInputs(s);
	if (item.kind === 'beat') return beatInputs(s);
	if (item.kind === 'review') return reviewInputs(s);
	return null;
}

/** The items each item is made from, as slot keys. */
function upstreamOf(s: PlotState, slot: string): string[] {
	const [kind] = slot.split(':');
	if (isElementKind(kind)) return ['structure'];
	if (kind === 'beat') return ['structure', ...ELEMENT_KINDS];
	if (kind === 'review') return beatKeys(s).map((k) => `beat:${k}`);
	return [];
}

/**
 * Where an item stands: missing, pending, outdated (made from inputs that
 * changed), upstream (an earlier step it is made from will change), or ok.
 */
export type Status = 'missing' | 'pending' | 'outdated' | 'upstream' | 'ok';

function statuses(s: PlotState, views: Map<string, ItemView>) {
	const memo = new Map<string, Status>();
	const locked = (slot: string) => Boolean(views.get(slot)?.locked);
	const status = (slot: string): Status => {
		const known = memo.get(slot);
		if (known) return known;
		const v = views.get(slot);
		const current = v?.versions.find((x) => x.id === v.currentId);
		let result: Status;
		if (v?.pending) result = 'pending';
		else if (!current) result = 'missing';
		else if (current.outOfDate.length) result = 'outdated';
		else {
			const changing = upstreamOf(s, slot).some((u) => !locked(u) && status(u) !== 'ok');
			result = changing ? 'upstream' : 'ok';
		}
		memo.set(slot, result);
		return result;
	};
	const settled = (slot: string) =>
		upstreamOf(s, slot).every((u) => locked(u) || status(u) === 'ok');
	return { status, settled };
}

const viewsOf = (db: Db, s: PlotState) =>
	describeScope(db, chapterScope(s.chapter.id), (i) => inputsFor(s, i), INPUT_LABELS);

/** Slots that can be (re)generated now: unlocked, missing or out of date, earlier steps settled. */
function dueSlots(db: Db, s: PlotState, stage: PlotStage): string[] {
	const views = viewsOf(db, s);
	const { status, settled } = statuses(s, views);
	const due = (slot: string) => {
		if (views.get(slot)?.locked) return false;
		const st = status(slot);
		return (st === 'missing' || st === 'outdated') && settled(slot);
	};
	if (!s.chapter.logline && !textOf(s, 'notes')) return [];
	if (stage === 'structure') return due('structure') ? ['structure'] : [];
	if (!structureOf(s)) return [];
	if (stage === 'elements') return ELEMENT_KINDS.filter(due);
	if (ELEMENT_KINDS.some((k) => !textOf(s, k))) return [];
	const beats = beatKeys(s).map((k) => `beat:${k}`);
	if (stage === 'beats') return beats.filter(due);
	if (beats.some((slot) => !s.current.get(slot))) return [];
	return due('review') ? ['review'] : [];
}

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
	const views = viewsOf(db, s);
	const { status } = statuses(s, views);
	const view = (slot: string) => {
		const [kind, key = ''] = slot.split(':');
		return views.get(slot) ?? emptyView(kind, key);
	};
	const structure = structureOf(s);
	const structureItem = view('structure');
	const questions = view('questions');
	const openQuestions = (() => {
		const cur = questions.versions.find((v) => v.id === questions.currentId);
		if (!cur || cur.outOfDate.length || questions.pending) return [];
		return parseQuestions(cur.text);
	})();
	const beats = structure
		? STRUCTURES[structure].beats.map((b) => {
				const slot = `beat:${b.key}`;
				return { ...b, item: view(slot), status: status(slot), value: parseBeat(textOf(s, slot)) };
			})
		: [];
	const review = view('review');
	const summary = (slots: string[]) => {
		const of = (want: Status[]) => slots.filter((slot) => want.includes(status(slot)));
		return {
			total: slots.length,
			pending: of(['pending']).length,
			missing: of(['missing']).length,
			stale: of(['outdated', 'upstream']).filter((slot) => !views.get(slot)?.locked).length,
			kept: slots.filter((slot) => views.get(slot)?.locked).length
		};
	};
	const due = Object.fromEntries(
		PLOT_STAGES.map((st) => [st, dueSlots(db, s, st).length])
	) as Record<PlotStage, number>;
	// The AI's latest notes on the elements.
	const elementNotes =
		ELEMENT_KINDS.map((k) => s.current.get(k))
			.filter((v): v is Version => Boolean(v?.notes))
			.sort((a, b) => b.id - a.id)[0]?.notes ?? '';
	return {
		pageTarget: s.chapter.pageTarget,
		hasIdea: Boolean(s.chapter.logline || textOf(s, 'notes')),
		/** Every series character, for the beats' character lists. */
		people: s.people.map((c) => ({ id: c.id, name: c.name, role: c.role })),
		cast: s.people.filter((c) => s.cast.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
		notes: view('notes'),
		questions: { item: questions, list: openQuestions },
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
			beatKeys(s)
				.map((k) => s.current.get(`beat:${k}`))
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
				missing: s.chapter.logline || textOf(s, 'notes') ? 0 : 1,
				stale: 0,
				kept: 0
			},
			structure: summary(['structure']),
			elements: summary([...ELEMENT_KINDS]),
			beats: summary(beatKeys(s).map((k) => `beat:${k}`)),
			review: summary(['review'])
		},
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

const item = (db: Db, s: PlotState, kind: string, key = '') =>
	ensureItem(db, s.series.ownerId, chapterScope(s.chapter.id), kind, key);

/** Set a new version of the user's own text, or only the lock when the text is unchanged. */
function saveOwn(db: Db, s: PlotState, it: Item, text: string, keep: boolean, generated: boolean) {
	const now = s.current.get(it.key ? `${it.kind}:${it.key}` : it.kind)?.text ?? '';
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
			{ origin: 'user', text, inputs: inputsFor(s, it) ?? {} },
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
	saveOwn(db, s, item(db, s, 'notes'), text.trim(), false, false);
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
	const it = item(db, s, 'structure');
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
	saveOwn(db, s, item(db, s, kind), text.trim(), keep, true);
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
		item(db, s, 'beat', key),
		beatText({ text, pages, characters: unique }),
		keep,
		true
	);
	syncCast(db, chapterId);
}

/** Options for the jobs a request starts. */
interface Start {
	guidance?: string;
	/** Stages to carry on with once this one finishes. */
	cascade?: PlotStage[];
}

function startJob(
	db: Db,
	s: PlotState,
	kind: string,
	slots: string[],
	opts: Start,
	extra: Record<string, unknown> = {}
): number {
	if (!slots.length) return 0;
	const started = run(() =>
		slots.map((slot) => {
			const [k, key = ''] = slot.split(':');
			return [slot, startVersion(db, item(db, s, k, key), { guidance: opts.guidance }).id] as const;
		})
	);
	const job = enqueue(db, s.series.ownerId, kind, {
		chapterId: s.chapter.id,
		versionIds: Object.fromEntries(started),
		guidance: opts.guidance?.trim() ?? '',
		cascade: opts.cascade ?? [],
		...extra
	});
	attachJob(
		db,
		started.map(([, id]) => id),
		job.id
	);
	return started.length;
}

const JOB_OF: Record<PlotStage, string> = {
	structure: 'plot.structure',
	elements: 'plot.elements',
	beats: 'plot.beats',
	review: 'plot.review'
};

const after = (stage: PlotStage, cascade: PlotStage[]) =>
	cascade.filter((st) => PLOT_STAGES.indexOf(st) > PLOT_STAGES.indexOf(stage));

function advance(db: Db, chapterId: number, stages: readonly PlotStage[]): number {
	const s = loadState(db, chapterId);
	if (!s) return 0;
	const cascade = [...stages];
	let started = 0;
	for (const stage of stages) {
		started += startJob(db, s, JOB_OF[stage], dueSlots(db, s, stage), { cascade });
	}
	return started;
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
	if (!s.chapter.logline && !textOf(s, 'notes')) {
		throw new PlotError('Write the logline or your notes first.');
	}
	return advance(db, chapterId, stages);
}

/**
 * Regenerate one stage (or one item of it) on request, with the user's
 * guidance; what comes after is carried on.
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
	const views = viewsOf(db, s);
	const all =
		stage === 'structure'
			? ['structure']
			: stage === 'elements'
				? [...ELEMENT_KINDS]
				: stage === 'beats'
					? beatKeys(s).map((k) => `beat:${k}`)
					: ['review'];
	if (stage !== 'structure' && !structureOf(s)) throw new PlotError('Choose a structure first.');
	if ((stage === 'beats' || stage === 'review') && ELEMENT_KINDS.some((k) => !textOf(s, k))) {
		throw new PlotError('Write the story elements first.');
	}
	const slots = (opts.only ? all.filter((slot) => slot === opts.only) : all).filter(
		(slot) => !views.get(slot)?.locked
	);
	if (!slots.length) throw new PlotError('It is locked. Unlock it to regenerate it.');
	const cascade = PLOT_STAGES.slice(PLOT_STAGES.indexOf(stage) + 1);
	return startJob(db, s, JOB_OF[stage], slots, { guidance: opts.guidance, cascade });
}

/** Ask the story editor what the idea leaves open. */
export function requestQuestions(db: Db, ownerId: number, seriesId: number, chapterId: number) {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	if (!s.chapter.logline && !textOf(s, 'notes')) {
		throw new PlotError('Write the logline or your notes first.');
	}
	const it = item(db, s, 'questions');
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
		startVersion(db, item(db, s, 'notes'), {
			guidance: answered.map((qa) => `${qa.question} ${qa.answer}`).join('\n')
		})
	);
	const job = enqueue(db, ownerId, 'plot.fold', { chapterId, versionId: version.id });
	attachJob(db, [version.id], job.id);
}

export function skipQuestions(db: Db, ownerId: number, seriesId: number, chapterId: number) {
	const s = ownedState(db, ownerId, seriesId, chapterId);
	run(() =>
		addVersion(db, item(db, s, 'questions'), {
			origin: 'user',
			text: '[]',
			inputs: ideaInputs(s)
		})
	);
}

// ---------------------------------------------------------------------------
// The AI's instructions

const EDITOR = `You are an experienced manga story editor helping a writer, who may be new to comics, plot one chapter of their manga.`;

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

const structureList = () =>
	STRUCTURE_KEYS.map(
		(k) =>
			`- "${k}": ${STRUCTURES[k].label}. ${STRUCTURES[k].bestFor} Beats: ${STRUCTURES[k].beats
				.map((b) => b.label)
				.join(', ')}.`
	).join('\n');

const STRUCTURE_SYSTEM = () => `${EDITOR}

Choose the story structure for one chapter that best fits the writer's idea. The structures:
${structureList()}

A chapter in an ongoing series usually ends on a hook, unless the idea is self-contained; a quiet or slice-of-life idea without a strong opponent suits kishōtenketsu.

Reply with only a JSON object with the keys "structure" (one of the quoted keys) and "reason" (one or two sentences to the writer on why it fits their idea).`;

const structureReply = z.object({ structure: z.string(), reason: z.string().default('') });

export function structureMessages(s: PlotState, guidance: string) {
	const lines = storyContext(s);
	if (guidance) lines.push(`The writer's feedback: ${guidance}`);
	return [
		{ role: 'system' as const, content: STRUCTURE_SYSTEM() },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const NEW_CHARACTERS = `- "newCharacters": the characters the beats name who are not yet in the series, as a list of objects with the keys "name" (the name the beats use), "role" ("protagonist", "antagonist", "supporting" or "minor") and "brief" (one or two sentences: who they are and their part in this chapter). Give each a name the story will keep. Empty when the series' characters are enough.`;

const ELEMENTS_SYSTEM = `${EDITOR}

Write the chapter's story elements: the parts of a proper story arc, so the conflict, its escalation, the climax, the resolution and the ending are clear before the outline is written. Build on the writer's idea and keep everything they wrote; invent what they left open, in keeping with the series, the cast's personalities and wants, and the chosen structure. Be specific to these characters: name them, and name what they do.

Reply with only a JSON object with these keys, each one to three sentences:
${ELEMENTS.map((e) => `- "${e.kind}": ${e.label}. ${e.hint}`).join('\n')}
- "notes": two or three sentences to the writer on the choices you made and what they might change.

For kishōtenketsu the conflict may be gentle or absent: say so in "conflict" and make the twist carry the chapter. For a serial chapter, "resolution" may be partial and "ending" is the cliffhanger.`;

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
	return [
		{ role: 'system' as const, content: ELEMENTS_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const BEATS_SYSTEM = `${EDITOR}

Write the chapter's beat outline: one entry for each beat of the chosen structure, in order. Each beat says, in two to four sentences, what happens: who is there, where (use the series' places by name when one fits), what they do and what changes. Follow the story elements, so the conflict escalates beat by beat and the climax, resolution and ending land where the elements say. Show, don't summarize: concrete actions and moments a manga page can draw.

Give each beat a number of pages so the total is the chapter's length. Pace it like manga: the climax gets room, and a page turn is a good place for a reveal.

Reply with only a JSON object with these keys:
- "beats": a list of objects with the keys "key", "text", "pages" and "characters" (the names of everyone who appears in the beat, exactly as the series or "newCharacters" names them), using exactly the beat keys asked for.
- "notes": one or two sentences to the writer about the pacing.
${NEW_CHARACTERS}`;

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
	const kept = beatKeys(s).filter((k) => !rewrite.includes(k) && textOf(s, `beat:${k}`));
	if (kept.length) {
		lines.push(
			'Kept beats (fit around these; do not repeat them):',
			...kept.map((k) => {
				const b = parseBeat(textOf(s, `beat:${k}`));
				return `- ${k} (${b?.pages ?? 0} pages; ${namesOf(s, b?.characters ?? []) || 'nobody'}): ${b?.text ?? ''}`;
			})
		);
	}
	if (guidance) {
		const previous = rewrite.filter((k) => textOf(s, `beat:${k}`));
		if (previous.length) {
			lines.push(
				'The current draft of the beats to rewrite:',
				...previous.map((k) => `- ${k}: ${parseBeat(textOf(s, `beat:${k}`))?.text ?? ''}`)
			);
		}
		lines.push(`The writer's feedback: ${guidance}`);
	}
	lines.push(`Beats to write: ${rewrite.join(', ')}`);
	return [
		{ role: 'system' as const, content: BEATS_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const REVIEW_SYSTEM = `${EDITOR}

Review the outline as a story editor would, honestly and specifically. Check:
- Does the protagonist want something clear, and does it cost them to get it?
- Does the conflict escalate, beat by beat, rather than repeat?
- Is the climax the protagonist's own choice or action, not luck or rescue?
- Is every setup paid off, and is every payoff set up?
- Does each character act as their personality and wants say?
- Does the pacing fit the pages: is the climax given room, is anything rushed or padded?
- Does the ending land: a clear dénouement, or a hook that makes the reader turn to the next chapter?

Reply with only a JSON object with the key "notes": a list of two to six objects with the keys "kind" ("strength" or "issue") and "text" (one or two sentences, naming the beat and suggesting a fix for an issue). Lead with the most important issue.`;

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
			const beat = parseBeat(textOf(s, `beat:${b.key}`));
			return `- ${b.label} (${beat?.pages ?? 0} pages): ${beat?.text ?? ''}`;
		})
	);
	if (guidance) lines.push(`The writer asks you to look at: ${guidance}`);
	return [
		{ role: 'system' as const, content: REVIEW_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const PLOT_QUESTIONS_SYSTEM = `${EDITOR}

Before the plot is written, ask the writer about the gaps in their chapter idea that would most change the story: what the protagonist wants and why now, what stands in the way, what is at stake, how it should end (resolved, or on a cliffhanger), the tone, or a key moment they already picture. Ask only about what their logline and notes leave open, at most four questions; a detailed idea needs one or two, or none.

Each question is short and specific to their chapter ("Does Jovi defy his mother openly, or sneak out?"), with two to four short suggested answers that fit the series and cast.

Reply with only a JSON object with the key "questions": a list of objects with the keys "question" and "suggestions" (a list of strings). The list may be empty.`;

const questionsReply = z.object({ questions: z.array(question).max(6).default([]) });

const PLOT_FOLD_SYSTEM = `${EDITOR}

The writer wrote notes on their chapter and answered some of your questions. Rewrite their chapter notes so they include the answers.

Keep everything they wrote and keep their voice; add each answer where it fits. Write plain prose, with no headings or lists. Do not add anything they did not say.

Reply with only a JSON object with the key "notes".`;

const foldReply = z.object({ notes: z.string().min(1) });

// ---------------------------------------------------------------------------
// Jobs

interface Payload {
	chapterId: number;
	versionIds: Record<string, number>;
	guidance: string;
	cascade: PlotStage[];
}

/**
 * The versions a job is still to make: those not dropped or replaced
 * meanwhile. (A job can start before it is attached to its versions, so this
 * checks the versions themselves, not their job.)
 */
function pendingOf(db: Db, versionIds: Record<string, number>) {
	return Object.entries(versionIds).filter(
		([, id]) =>
			db.select({ status: versions.status }).from(versions).where(eq(versions.id, id)).get()
				?.status === 'pending'
	);
}

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
		.map((k) => parseBeat(textOf(s, `beat:${k}`)))
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

const structureHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { chapterId, versionIds, guidance, cascade } = job.payload as Payload;
	const s = loadState(db, chapterId);
	if (!s || !pendingOf(db, versionIds).length) return;
	const reply = await ai.text.json(structureMessages(s, guidance), structureReply, signal);
	const key = reply.structure.trim();
	if (!isStructure(key)) throw new Error(`The AI chose an unknown structure: ${key}`);
	finishVersion(db, versionIds.structure!, {
		text: key,
		notes: reply.reason.trim(),
		inputs: structureInputs(s),
		model: ai.text.name
	});
	advance(db, chapterId, after('structure', cascade));
};

const elementsHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { chapterId, versionIds, guidance, cascade } = job.payload as Payload;
	const s = loadState(db, chapterId);
	if (!s || !structureOf(s)) return;
	const rewrite = ELEMENT_KINDS.filter((k) => versionIds[k] !== undefined);
	const reply = await ai.text.json(elementsMessages(s, rewrite, guidance), elementsReply, signal);
	const notes = reply.notes.trim();
	const inputs = elementInputs(s);
	for (const kind of rewrite) {
		const text = reply[kind]?.trim();
		if (text) {
			finishVersion(db, versionIds[kind]!, {
				text,
				inputs,
				notes,
				model: ai.text.name
			});
		} else abandonVersion(db, versionIds[kind]!);
	}
	advance(db, chapterId, after('elements', cascade));
};

const beatsHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { chapterId, versionIds, guidance, cascade } = job.payload as Payload;
	const s = loadState(db, chapterId);
	if (!s || !structureOf(s)) return;
	const rewrite = beatKeys(s).filter((k) => versionIds[`beat:${k}`] !== undefined);
	// Beats of a structure no longer in use are dropped.
	for (const [slot, id] of Object.entries(versionIds)) {
		if (!rewrite.includes(slot.split(':')[1] ?? '')) abandonVersion(db, id);
	}
	if (!rewrite.length) return;
	const reply = await ai.text.json(beatsMessages(s, rewrite, guidance), beatsReply, signal);
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
	const inputs = beatInputs(s);
	rewrite.forEach((key, i) => {
		const id = versionIds[`beat:${key}`]!;
		const b = written[i];
		if (b?.text.trim()) {
			finishVersion(db, id, {
				text: beatText({
					text: b.text.trim(),
					pages: Math.max(0, Math.round(b.pages)),
					characters: ids[i]!
				}),
				inputs,
				notes,
				model: ai.text.name
			});
		} else abandonVersion(db, id);
	});
	syncCast(db, chapterId);
	advance(db, chapterId, after('beats', cascade));
};

const reviewHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { chapterId, versionIds, guidance } = job.payload as Payload;
	const s = loadState(db, chapterId);
	if (!s || !structureOf(s)) return;
	const reply = await ai.text.json(reviewMessages(s, guidance), reviewReply, signal);
	finishVersion(db, versionIds.review!, {
		text: JSON.stringify(reply.notes.slice(0, 8)),
		inputs: reviewInputs(s),
		model: ai.text.name
	});
};

const questionsHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { chapterId, versionId } = job.payload as { chapterId: number; versionId: number };
	const s = loadState(db, chapterId);
	if (!s) return;
	const reply = await ai.text.json(
		[
			{ role: 'system', content: PLOT_QUESTIONS_SYSTEM },
			{ role: 'user', content: storyContext(s).join('\n') }
		],
		questionsReply,
		signal
	);
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
		model: ai.text.name
	});
};

const foldHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { chapterId, versionId } = job.payload as { chapterId: number; versionId: number };
	const s = loadState(db, chapterId);
	const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
	if (!s || version?.status !== 'pending') return;
	const reply = await ai.text.json(
		[
			{ role: 'system', content: PLOT_FOLD_SYSTEM },
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
	finishVersion(db, versionId, {
		text: reply.notes.trim(),
		notes: 'Your answers, folded into your notes.',
		model: ai.text.name
	});
	// The questions were about the old notes; they are now answered.
	const now = loadState(db, chapterId)!;
	const questions = item(db, now, 'questions');
	if (!questions.locked) {
		addVersion(db, questions, { origin: 'user', text: '[]', inputs: ideaInputs(now) });
	}
};

export const plotJobHandlers: Record<string, JobHandler> = {
	'plot.structure': structureHandler,
	'plot.elements': elementsHandler,
	'plot.beats': beatsHandler,
	'plot.review': reviewHandler,
	'plot.questions': questionsHandler,
	'plot.fold': foldHandler
};

export { ChapterError, DEFAULT_PAGE_TARGET };
