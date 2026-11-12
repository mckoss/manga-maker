/**
 * A chapter's script (see "3b. Script" in PLAN.md and the types in
 * `#lib/script.js`): pages → panels → words, as versioned items in the scope
 * `script:<chapterId>`. Every command here is the user's own edit
 * (origin 'user'), except the help jobs (see "Help"), which write only into
 * blank staging fields and never write words. Script items are never locked.
 *
 * The layout is one item; `writeLayout` keeps its pages grouped by beat in
 * the plot's beat order, with pages whose beat left the outline (orphans)
 * last, in their existing order.
 */
import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import { characters, locations, series, versions, type Version } from './db/schema';
import {
	emptyPanel,
	isBlank,
	isId,
	isShot,
	isTextKind,
	layoutText,
	newId,
	panelText,
	parseLayout,
	parsePanel,
	parseWords,
	wordsText,
	STAGING_FIELDS,
	type Layout,
	type PageView,
	type Panel,
	type ScriptDetail,
	type ScriptItemState,
	type ScriptPage,
	type StagingField,
	type TextBlock
} from '#lib/script.js';
import { STRUCTURES, isStructure, type StructureKey } from '#lib/structures.js';
import {
	abandonVersion,
	addVersion,
	attachJob,
	currentVersions,
	deleteItems,
	describeScope,
	ensureItem,
	finishVersion,
	startVersion,
	VersionError,
	type Access,
	type ItemView
} from './versions';
import { ownedChapter } from './chapters';
import { touchSeries } from './series';
import { chapterContext, parseBeat } from './plots';
import { enqueue, type JobHandler } from './jobs';
import { askJson, type PromptStamp } from './prompts/ask';
import { putRun } from './runs';
import { scopeOf, slot, slotKeyOf } from './pipeline/ids';

export class ScriptError extends Error {}

// ---------------------------------------------------------------------------
// State

/** A short fingerprint of a beat's text, as a page records it in `seen`. */
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const LAYOUT = slot('layout');
const panelKey = (pid: string) => slotKeyOf('panel', pid);
const wordsKey = (pid: string) => slotKeyOf('words', pid);
/** A help job laying out a beat, or filling in a page (see "Help"). */
const HELP_BEAT = 'help-beat';
const HELP_PAGE = 'help-page';
const helpBeatKey = (beat: string) => slotKeyOf(HELP_BEAT, beat);
const helpPageKey = (pid: string) => slotKeyOf(HELP_PAGE, pid);

interface ScriptState {
	db: Db;
	ownerId: number;
	seriesId: number;
	chapterId: number;
	scope: string;
	chapter: ReturnType<typeof ownedChapter>;
	structure: StructureKey | null;
	/** The current structure's beat keys, in order. */
	beatKeys: string[];
	/** The plot's current versions (scope chapter:<id>). */
	plot: Map<string, Version>;
	/** The script's current versions. */
	current: Map<string, Version>;
	layout: Layout;
}

function load(db: Db, ownerId: number, seriesId: number, chapterId: number): ScriptState {
	const chapter = ownedChapter(db, ownerId, seriesId, chapterId);
	const plot = currentVersions(db, scopeOf.chapter(chapterId));
	const key = plot.get('structure')?.text ?? '';
	const structure = isStructure(key) ? key : null;
	const scope = scopeOf.script(chapterId);
	const current = currentVersions(db, scope);
	return {
		db,
		ownerId,
		seriesId,
		chapterId,
		scope,
		chapter,
		structure,
		beatKeys: structure ? STRUCTURES[structure].beats.map((b) => b.key) : [],
		plot,
		current,
		layout: parseLayout(current.get(LAYOUT.kind)?.text)
	};
}

const beatOf = (s: ScriptState, key: string) => parseBeat(s.plot.get(slotKeyOf('beat', key))?.text);

/** The digest of a beat's current text ('' text when not written yet). */
const beatDigest = (s: ScriptState, key: string) => digest(beatOf(s, key)?.text ?? '');

interface Cast {
	people: { id: number; name: string }[];
	places: { id: number; name: string }[];
}

/** The series' characters and places, by name. */
function castOf(db: Db, seriesId: number): Cast {
	const people = db
		.select()
		.from(characters)
		.where(eq(characters.seriesId, seriesId))
		.orderBy(asc(characters.id))
		.all()
		.map((c) => ({
			id: c.id,
			name: c.name || currentVersions(db, scopeOf.character(c.id)).get('name')?.text || 'Unnamed'
		}));
	const places = db
		.select()
		.from(locations)
		.where(eq(locations.seriesId, seriesId))
		.orderBy(asc(locations.id))
		.all()
		.map((l) => ({
			id: l.id,
			name:
				l.name || currentVersions(db, scopeOf.location(l.id)).get('name')?.text || 'Unnamed place'
		}));
	return { people, places };
}

const seriesIds = (db: Db, table: typeof characters | typeof locations, seriesId: number) =>
	new Set(
		db
			.select({ id: table.id })
			.from(table)
			.where(eq(table.seriesId, seriesId))
			.all()
			.map((r) => r.id)
	);

/** Turn a VersionError into a ScriptError the page shows. */
function run<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof VersionError) throw new ScriptError(e.message);
		throw e;
	}
}

/** Write the user's text to a slot, unless it is unchanged. Returns whether it wrote. */
function write(s: ScriptState, kind: string, key: string | null, text: string): boolean {
	const ref = slot(kind, key);
	const sk = slotKeyOf(ref.kind, ref.key);
	if (s.current.get(sk)?.text === text) return false;
	const it = ensureItem(s.db, s.ownerId, s.scope, ref.kind, ref.key ?? '');
	s.current.set(
		sk,
		run(() => addVersion(s.db, it, { origin: 'user', text }))
	);
	touchSeries(s.db, s.seriesId);
	return true;
}

/** Pages grouped by beat in the outline's order; orphans last, as they were. */
function normalize(s: ScriptState, pages: ScriptPage[]): ScriptPage[] {
	const rank = (p: ScriptPage) => {
		const i = s.beatKeys.indexOf(p.beat);
		return i < 0 ? s.beatKeys.length : i;
	};
	return pages
		.map((p, i) => ({ p, i }))
		.sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
		.map(({ p }) => p);
}

function writeLayout(s: ScriptState, pages: ScriptPage[]) {
	s.layout = { pages: normalize(s, pages) };
	write(s, LAYOUT.kind, null, layoutText(s.layout));
}

function findPage(s: ScriptState, pageId: string): ScriptPage {
	const page = s.layout.pages.find((p) => p.id === pageId);
	if (!page) throw new ScriptError('Page not found.');
	return page;
}

function findPanel(s: ScriptState, panelId: string): ScriptPage {
	const page = s.layout.pages.find((p) => p.panels.includes(panelId));
	if (!page) throw new ScriptError('Panel not found.');
	return page;
}

function checkBeat(s: ScriptState, beat: string) {
	if (!s.beatKeys.includes(beat)) throw new ScriptError('Unknown beat.');
}

/** Swap an element of a list with its neighbor in a direction; false at the edge. */
function swap<T>(list: T[], i: number, j: number): boolean {
	if (i < 0 || j < 0 || i >= list.length || j >= list.length) return false;
	[list[i], list[j]] = [list[j], list[i]];
	return true;
}

const checkDir = (dir: number) => {
	if (dir !== -1 && dir !== 1) throw new ScriptError('Move up or down.');
};

// ---------------------------------------------------------------------------
// Queries

/** Who may change a chapter's script items. */
export function scriptAccess(db: Db, ownerId: number, seriesId: number, chapterId: number): Access {
	ownedChapter(db, ownerId, seriesId, chapterId);
	return { ownerId, scope: scopeOf.script(chapterId) };
}

const itemState = (v: ItemView | undefined): ScriptItemState | null =>
	v ? { id: v.id, pending: v.pending, error: v.error, versions: v.versions.length } : null;

export function getScript(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number
): ScriptDetail {
	const s = load(db, ownerId, seriesId, chapterId);
	const owner = db.select().from(series).where(eq(series.id, seriesId)).get()!;
	const views = describeScope(db, s.scope, () => null, {});
	const { people, places } = castOf(db, seriesId);

	let number = 0;
	const totals = { pages: 0, panels: 0, blocks: 0 };
	const pageView = (page: ScriptPage, beatDigest: string | null): PageView => {
		totals.pages++;
		const help = views.get(helpPageKey(page.id));
		return {
			id: page.id,
			beat: page.beat,
			purpose: page.purpose,
			turn: page.turn,
			keyPanel: page.keyPanel,
			seen: page.seen,
			number: ++number,
			beatChanged: beatDigest !== null && page.seen !== beatDigest,
			pending: help?.pending ?? false,
			error: help?.error ?? null,
			panels: page.panels.map((pid, i) => {
				const words = parseWords(s.current.get(wordsKey(pid))?.text);
				totals.panels++;
				totals.blocks += words.filter((w) => w.text.trim()).length;
				return {
					id: pid,
					number: i + 1,
					panel: parsePanel(s.current.get(panelKey(pid))?.text),
					words,
					isKey: page.keyPanel === pid,
					item: itemState(views.get(panelKey(pid))),
					wordsItem: itemState(views.get(wordsKey(pid)))
				};
			})
		};
	};

	const beats = s.structure
		? STRUCTURES[s.structure].beats.map((b) => {
				const value = beatOf(s, b.key);
				const d = digest(value?.text ?? '');
				const help = views.get(helpBeatKey(b.key));
				return {
					key: b.key,
					label: b.label,
					hint: b.hint,
					text: value?.text ?? '',
					plannedPages: value?.pages ?? 0,
					characters: value?.characters ?? [],
					pages: s.layout.pages.filter((p) => p.beat === b.key).map((p) => pageView(p, d)),
					pending: help?.pending ?? false,
					error: help?.error ?? null
				};
			})
		: [];
	const orphans = s.layout.pages
		.filter((p) => !s.beatKeys.includes(p.beat))
		.map((p) => pageView(p, null));

	return {
		readingDirection: owner.readingDirection,
		pageTarget: s.chapter.pageTarget,
		hasOutline: beats.some((b) => b.text !== ''),
		people,
		places,
		beats,
		orphans,
		totals,
		busy: [...views.values()].some((v) => v.pending)
	};
}

// ---------------------------------------------------------------------------
// Pages

/** Add a page to a beat, after `after` (a page id) or at the end of the beat's pages. Returns its id. */
export function addPage(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	beat: string,
	after?: string | null
): string {
	const s = load(db, ownerId, seriesId, chapterId);
	checkBeat(s, beat);
	const page: ScriptPage = {
		id: newId(),
		beat,
		purpose: '',
		turn: false,
		keyPanel: null,
		panels: [],
		seen: beatDigest(s, beat)
	};
	const pages = normalize(s, s.layout.pages);
	if (after) {
		const i = pages.findIndex((p) => p.id === after);
		if (i < 0 || pages[i].beat !== beat) throw new ScriptError('Page not found in this beat.');
		pages.splice(i + 1, 0, page);
	} else {
		// Normalizing moves it to the end of its beat's pages.
		pages.push(page);
	}
	writeLayout(s, pages);
	return page.id;
}

export function savePage(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	pageId: string,
	fields: { purpose?: string; turn?: boolean; keyPanel?: string | null; beat?: string }
): void {
	const s = load(db, ownerId, seriesId, chapterId);
	const old = findPage(s, pageId);
	const page = { ...old };
	if (fields.purpose !== undefined) page.purpose = String(fields.purpose).trim();
	if (fields.turn !== undefined) page.turn = fields.turn === true;
	if (fields.keyPanel !== undefined) {
		if (fields.keyPanel !== null && !page.panels.includes(fields.keyPanel)) {
			throw new ScriptError('The key panel must be one of the page’s panels.');
		}
		page.keyPanel = fields.keyPanel;
	}
	let pages = s.layout.pages.map((p) => (p.id === pageId ? page : p));
	if (fields.beat !== undefined && fields.beat !== old.beat) {
		checkBeat(s, fields.beat);
		page.beat = fields.beat;
		page.seen = beatDigest(s, fields.beat);
		// To the end of its new beat's pages.
		pages = [...pages.filter((p) => p.id !== pageId), page];
	}
	writeLayout(s, pages);
}

/** Move a page one place earlier (-1) or later (1) among its beat's pages. */
export function movePage(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	pageId: string,
	dir: -1 | 1
): void {
	checkDir(dir);
	const s = load(db, ownerId, seriesId, chapterId);
	findPage(s, pageId);
	const pages = normalize(s, s.layout.pages);
	const i = pages.findIndex((p) => p.id === pageId);
	if (pages[i + dir]?.beat !== pages[i].beat) return;
	swap(pages, i, i + dir);
	writeLayout(s, pages);
}

/** Delete a page with its panels and their words. */
export function deletePage(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	pageId: string
): void {
	const s = load(db, ownerId, seriesId, chapterId);
	const page = findPage(s, pageId);
	db.transaction(() => {
		writeLayout(
			s,
			s.layout.pages.filter((p) => p.id !== pageId)
		);
		// Its help job too, if one is working on it.
		deleteItems(db, s.scope, [
			...page.panels.flatMap((pid) => [panelKey(pid), wordsKey(pid)]),
			helpPageKey(pageId)
		]);
	});
}

/** The user has looked at a page after its beat changed: it is no longer flagged. */
export function checkPage(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	pageId: string
): void {
	const s = load(db, ownerId, seriesId, chapterId);
	const page = findPage(s, pageId);
	if (!s.beatKeys.includes(page.beat)) return;
	const seen = beatDigest(s, page.beat);
	writeLayout(
		s,
		s.layout.pages.map((p) => (p.id === pageId ? { ...p, seen } : p))
	);
}

// ---------------------------------------------------------------------------
// Panels

/** Add a panel to a page, after `after` (a panel id) or at the end. Returns its id. */
export function addPanel(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	pageId: string,
	after?: string | null
): string {
	const s = load(db, ownerId, seriesId, chapterId);
	const page = findPage(s, pageId);
	const id = newId();
	const panels = [...page.panels];
	if (after) {
		const i = panels.indexOf(after);
		if (i < 0) throw new ScriptError('Panel not found on this page.');
		panels.splice(i + 1, 0, id);
	} else {
		panels.push(id);
	}
	// Its staging item is made on first save; until then it shows as empty.
	writeLayout(
		s,
		s.layout.pages.map((p) => (p.id === pageId ? { ...p, panels } : p))
	);
	return id;
}

/** Move a panel one place earlier (-1) or later (1) on its page. */
export function movePanel(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	panelId: string,
	dir: -1 | 1
): void {
	checkDir(dir);
	const s = load(db, ownerId, seriesId, chapterId);
	const page = findPanel(s, panelId);
	const panels = [...page.panels];
	const i = panels.indexOf(panelId);
	if (!swap(panels, i, i + dir)) return;
	writeLayout(
		s,
		s.layout.pages.map((p) => (p.id === page.id ? { ...p, panels } : p))
	);
}

export function deletePanel(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	panelId: string
): void {
	const s = load(db, ownerId, seriesId, chapterId);
	const page = findPanel(s, panelId);
	const next: ScriptPage = {
		...page,
		panels: page.panels.filter((pid) => pid !== panelId),
		keyPanel: page.keyPanel === panelId ? null : page.keyPanel
	};
	db.transaction(() => {
		writeLayout(
			s,
			s.layout.pages.map((p) => (p.id === page.id ? next : p))
		);
		deleteItems(db, s.scope, [panelKey(panelId), wordsKey(panelId)]);
	});
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Save the user's staging fields; a field they change is no longer an "AI draft". */
export function savePanel(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	panelId: string,
	fields: Partial<Pick<Panel, 'shot' | 'location' | 'characters' | 'action' | 'cue'>>
): void {
	const s = load(db, ownerId, seriesId, chapterId);
	findPanel(s, panelId);
	const now = parsePanel(s.current.get(panelKey(panelId))?.text);
	const next: Panel = { ...now, characters: [...now.characters], ai: [...now.ai] };

	if (fields.shot !== undefined) {
		if (fields.shot !== '' && !isShot(fields.shot)) throw new ScriptError('Unknown shot.');
		next.shot = fields.shot;
	}
	if (fields.location !== undefined) {
		const loc = fields.location;
		if (loc !== null && !seriesIds(db, locations, seriesId).has(loc)) {
			throw new ScriptError('Unknown location.');
		}
		next.location = loc;
	}
	if (fields.characters !== undefined) {
		if (!Array.isArray(fields.characters)) throw new ScriptError('Characters must be a list.');
		const valid = seriesIds(db, characters, seriesId);
		next.characters = [...new Set(fields.characters.map(Number))].filter((id) => valid.has(id));
	}
	if (fields.action !== undefined) next.action = String(fields.action).trim();
	if (fields.cue !== undefined) next.cue = String(fields.cue).trim();

	const changed = new Set<StagingField>(STAGING_FIELDS.filter((f) => !same(now[f], next[f])));
	next.ai = next.ai.filter((f) => !changed.has(f));
	// Nothing to record for an untouched, never-saved panel.
	if (!s.current.has(panelKey(panelId)) && same(next, emptyPanel())) return;
	write(s, 'panel', panelId, panelText(next));
}

/** Save a panel's words (the whole list, in order). */
export function saveWords(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	panelId: string,
	blocks: TextBlock[]
): void {
	const s = load(db, ownerId, seriesId, chapterId);
	findPanel(s, panelId);
	if (!Array.isArray(blocks)) throw new ScriptError('Words must be a list.');
	const people = seriesIds(db, characters, seriesId);
	const ids = new Set<string>();
	const words: TextBlock[] = [];
	for (const b of blocks) {
		if (!b || !isTextKind(b.kind)) throw new ScriptError('Unknown kind of text.');
		let id = b.id;
		if (id === undefined || id === null || id === '' || ids.has(id)) id = newId();
		else if (!isId(id)) throw new ScriptError('Bad text block id.');
		ids.add(id);
		let speaker = b.kind === 'caption' || b.kind === 'sfx' ? null : (b.speaker ?? null);
		if (speaker !== null) {
			speaker = Number(speaker);
			if (!people.has(speaker)) throw new ScriptError('Unknown speaker.');
		}
		const text = String(b.text ?? '').trim();
		if (!text) continue;
		words.push({ id, kind: b.kind, speaker, text });
	}
	if (!s.current.has(wordsKey(panelId)) && !words.length) return;
	write(s, 'words', panelId, wordsText(words));
}

// ---------------------------------------------------------------------------
// Help
//
// "Help me lay out this beat" (`requestLayout`, job `script.layout`) drafts
// the pages and panels of a beat that has none yet; "Help me fill this in"
// (`requestFill`, job `script.fill`) drafts a page's blank purpose and its
// panels' blank staging fields. The rules (see "3b. Script" in PLAN.md):
//
// - Help writes only into blanks, checked again against the current script
//   when the job finishes (the user may have typed meanwhile).
// - Help never writes words: the replies have no words fields, and
//   `writeAi` refuses every slot but the layout and panels.
// - Nothing cascades: a help job changes only what it was asked about.
//
// Each request is a pending version of a help item (`help-beat:<key>` or
// `help-page:<pageId>`), so the beat or page shows it as pending or failed;
// the finished version's text says what the AI did, with its notes.

/** A help job's AI step, as the versions it writes record it. */
interface AiStamp extends PromptStamp {
	model: string;
	runHash: string;
}

/** Write the AI's draft to the layout or a panel. Never words: those are the user's. */
function writeAi(s: ScriptState, kind: string, key: string | null, text: string, stamp: AiStamp) {
	if (kind !== LAYOUT.kind && kind !== 'panel') {
		throw new Error(`A help job may not write "${kind}".`);
	}
	const sk = slotKeyOf(kind, key);
	if (s.current.get(sk)?.text === text) return;
	const it = ensureItem(s.db, s.ownerId, s.scope, kind, key ?? '');
	s.current.set(sk, addVersion(s.db, it, { origin: 'ai', text, ...stamp }));
	touchSeries(s.db, s.seriesId);
}

function writeAiLayout(s: ScriptState, pages: ScriptPage[], stamp: AiStamp) {
	s.layout = { pages: normalize(s, pages) };
	writeAi(s, LAYOUT.kind, null, layoutText(s.layout), stamp);
}

interface HelpPayload {
	seriesId: number;
	chapterId: number;
	versionId: number;
}

function startHelp(
	s: ScriptState,
	jobKind: 'script.layout' | 'script.fill',
	kind: string,
	key: string,
	guidance: string | undefined,
	extra: Record<string, unknown>
) {
	const it = ensureItem(s.db, s.ownerId, s.scope, kind, key);
	const version = run(() => startVersion(s.db, it, { guidance }));
	const payload = {
		seriesId: s.seriesId,
		chapterId: s.chapterId,
		versionId: version.id,
		...extra
	};
	const job = enqueue(s.db, s.ownerId, jobKind, payload);
	attachJob(s.db, [version.id], job.id);
}

/** A help job's version, if it is still wanted (not dropped with its page or chapter). */
const helpVersion = (db: Db, versionId: number) => {
	const v = db.select().from(versions).where(eq(versions.id, versionId)).get();
	return v?.status === 'pending' ? v : undefined;
};

// What the AI may draft: staging, resolved to the series' own ids.

const clip = (text: string, max = 600) => text.trim().slice(0, max);

const panelReply = z.object({
	shot: z.string().catch(''),
	location: z.string().nullish().catch(''),
	characters: z.array(z.string()).catch([]),
	action: z.string().catch(''),
	cue: z.string().catch('')
});
type PanelReply = z.infer<typeof panelReply>;

const layoutReply = z.object({
	pages: z
		.array(
			z.object({
				purpose: z.string().catch(''),
				turn: z.boolean().catch(false),
				panels: z.array(panelReply).catch([])
			})
		)
		.default([]),
	notes: z.string().catch('')
});

const fillReply = z.object({
	purpose: z.string().catch(''),
	panels: z.array(panelReply.extend({ id: z.string().catch('') })).default([]),
	notes: z.string().catch('')
});

const MAX_PANELS = 8;

const byName = (list: { id: number; name: string }[]) =>
	new Map(list.map((x) => [x.name.trim().toLowerCase(), x.id] as const));

/** A panel from the AI's reply; names the series doesn't have are dropped (never created). */
function draftPanel(r: PanelReply, cast: Cast): Panel {
	const people = byName(cast.people);
	const places = byName(cast.places);
	const shot = r.shot.trim().toLowerCase();
	const ids = r.characters
		.map((n) => people.get(n.trim().toLowerCase()))
		.filter((id): id is number => id !== undefined);
	return {
		shot: isShot(shot) ? shot : '',
		location: places.get((r.location ?? '').trim().toLowerCase()) ?? null,
		characters: [...new Set(ids)],
		action: clip(r.action),
		cue: clip(r.cue, 300),
		ai: []
	};
}

/** A new panel drafted by the AI: every field it filled is marked as its draft. */
const newAiPanel = (draft: Panel): Panel => ({
	...draft,
	ai: STAGING_FIELDS.filter((f) => !isBlank(draft, f))
});

/** The staging fields the AI can fill: not where the series has nothing to choose from. */
const fillable = (cast: Cast) =>
	STAGING_FIELDS.filter(
		(f) =>
			(f !== 'location' || cast.places.length > 0) && (f !== 'characters' || cast.people.length > 0)
	);

// What the AI is told (its system prompts are in prompts/script.ts). Words
// are shown to it, as the writer's, so staging fits them; it never writes them.

function helpContext(s: ScriptState, cast: Cast): string[] {
	const lines = chapterContext(s.db, s.chapterId).filter(
		(l) => !l.startsWith('The series has no characters yet')
	);
	if (!cast.people.length)
		lines.push('The series has no characters yet: leave "characters" empty.');
	if (!cast.places.length) lines.push('The series has no places yet: leave "location" empty.');
	return lines;
}

function beatLines(s: ScriptState, beat: string, cast: Cast): string[] {
	const b = s.structure ? STRUCTURES[s.structure].beats.find((x) => x.key === beat) : undefined;
	const value = beatOf(s, beat);
	const names = (value?.characters ?? [])
		.map((id) => cast.people.find((c) => c.id === id)?.name)
		.filter(Boolean);
	return [
		`The beat: ${b?.label ?? beat}${b ? ` (${b.hint})` : ''}`,
		`What happens: ${value?.text || '(not written yet)'}`,
		...(names.length ? [`Who is in it: ${names.join(', ')}`] : [])
	];
}

const neighborLine = (label: string, page: ScriptPage | undefined) =>
	page ? [`${label}: ${page.purpose || '(its purpose is not written yet)'}`] : [];

const feedbackLine = (guidance: string) =>
	guidance.trim() ? [`The writer's feedback: ${guidance.trim()}`] : [];

function stagingLine(p: Panel, cast: Cast): string {
	const name = (list: Cast['people'], id: number) => list.find((x) => x.id === id)?.name ?? '';
	const parts: string[] = [];
	if (p.shot) parts.push(`shot: ${p.shot}`);
	if (p.location !== null) parts.push(`location: ${name(cast.places, p.location)}`);
	if (p.characters.length) {
		parts.push(`characters: ${p.characters.map((id) => name(cast.people, id)).join(', ')}`);
	}
	if (p.action) parts.push(`action: ${p.action}`);
	if (p.cue) parts.push(`cue: ${p.cue}`);
	return parts.join('; ');
}

function wordsLine(words: TextBlock[], cast: Cast): string {
	const label = { speech: 'says', thought: 'thinks', caption: 'caption', sfx: 'sound effect' };
	return words
		.filter((w) => w.text.trim())
		.map((w) => {
			const who = w.speaker ? cast.people.find((c) => c.id === w.speaker)?.name : undefined;
			return `${who ? `${who} ${label[w.kind]}` : label[w.kind]}: "${w.text}"`;
		})
		.join('; ');
}

// ---------------------------------------------------------------------------
// Help: lay out a beat

/** Ask the AI to lay out a written beat that has no pages yet. */
export function requestLayout(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	beat: string,
	guidance?: string
): void {
	const s = load(db, ownerId, seriesId, chapterId);
	checkBeat(s, beat);
	if (!beatOf(s, beat)?.text) throw new ScriptError('Write this beat in the plot first.');
	if (s.layout.pages.some((p) => p.beat === beat)) {
		throw new ScriptError('This beat already has pages; use Help me fill this in on a page.');
	}
	startHelp(s, 'script.layout', HELP_BEAT, beat, guidance, { beat });
}

function layoutMessage(s: ScriptState, beat: string, cast: Cast, guidance: string): string {
	const rank = (p: ScriptPage) => s.beatKeys.indexOf(p.beat);
	const at = s.beatKeys.indexOf(beat);
	const pages = s.layout.pages.filter((p) => rank(p) >= 0);
	const pagesWanted = Math.max(1, beatOf(s, beat)?.pages ?? 1);
	return [
		...helpContext(s, cast),
		...beatLines(s, beat, cast),
		...neighborLine(
			'The page before this beat',
			pages.findLast((p) => rank(p) < at)
		),
		...neighborLine(
			'The page after this beat',
			pages.find((p) => rank(p) > at)
		),
		`Pages to lay out: ${pagesWanted}`,
		...feedbackLine(guidance)
	].join('\n');
}

const layoutHandler: JobHandler = async (job, { db, ai, signal }) => {
	const p = job.payload as HelpPayload & { beat: string };
	const version = helpVersion(db, p.versionId);
	if (!version) return;
	const s = load(db, job.userId, p.seriesId, p.chapterId);
	const cast = castOf(db, p.seriesId);
	const hasPages = (st: ScriptState) => st.layout.pages.some((pg) => pg.beat === p.beat);
	if (!s.beatKeys.includes(p.beat) || !beatOf(s, p.beat)?.text || hasPages(s)) {
		finishVersion(db, version.id, {
			text: 'Nothing was laid out: the beat has pages now, or is no longer in the outline.'
		});
		return;
	}
	const pagesWanted = Math.max(1, beatOf(s, p.beat)?.pages ?? 1);
	const {
		value: reply,
		prompt,
		run: record
	} = await askJson(
		ai,
		'script.layout',
		[{ role: 'user', content: layoutMessage(s, p.beat, cast, version.guidance) }],
		layoutReply,
		signal
	);
	const runHash = await putRun(db, record);
	const stamp: AiStamp = { model: ai.text.name, ...prompt, runHash };

	// Again, now: the user may have added pages while the AI worked.
	if (!helpVersion(db, version.id)) return;
	const now = load(db, job.userId, p.seriesId, p.chapterId);
	if (!now.beatKeys.includes(p.beat) || hasPages(now)) {
		finishVersion(db, version.id, {
			text: 'Nothing was added: you added pages to this beat while the AI worked.',
			notes: reply.notes,
			...stamp
		});
		return;
	}
	const drafts = reply.pages.slice(0, pagesWanted);
	if (!drafts.length) throw new Error('The AI laid out no pages. Try again.');
	const seen = beatDigest(now, p.beat);
	db.transaction(() => {
		const pages = drafts.map((d): ScriptPage => {
			const panels = d.panels.slice(0, MAX_PANELS).map((r) => {
				const pid = newId();
				writeAi(now, 'panel', pid, panelText(newAiPanel(draftPanel(r, cast))), stamp);
				return pid;
			});
			return {
				id: newId(),
				beat: p.beat,
				purpose: clip(d.purpose, 300),
				turn: d.turn,
				keyPanel: null,
				panels,
				seen
			};
		});
		// The user's pages exactly as they are; the new ones join in the beat's place.
		writeAiLayout(now, [...now.layout.pages, ...pages], stamp);
		const n = pages.length;
		finishVersion(db, version.id, {
			text: `Laid out ${n} page${n === 1 ? '' : 's'} with ${pages.reduce((a, pg) => a + pg.panels.length, 0)} panels.`,
			notes: reply.notes,
			...stamp
		});
	});
};

// ---------------------------------------------------------------------------
// Help: fill in a page

/** A page's blanks: its purpose, each panel's blank staging fields, and panels if it has none. */
function blanksOf(s: ScriptState, page: ScriptPage, cast: Cast) {
	const fields = fillable(cast);
	const panels = new Map<string, StagingField[]>();
	for (const pid of page.panels) {
		const panel = parsePanel(s.current.get(panelKey(pid))?.text);
		const blank = fields.filter((f) => isBlank(panel, f));
		if (blank.length) panels.set(pid, blank);
	}
	const purpose = !page.purpose.trim();
	const newPanels = page.panels.length === 0;
	return { purpose, panels, newPanels, any: purpose || newPanels || panels.size > 0 };
}

/** Ask the AI to fill in a page's blanks. */
export function requestFill(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	pageId: string,
	guidance?: string
): void {
	const s = load(db, ownerId, seriesId, chapterId);
	const page = findPage(s, pageId);
	if (!s.beatKeys.includes(page.beat)) {
		throw new ScriptError('This page’s beat is not in the outline: move it to a beat first.');
	}
	if (!blanksOf(s, page, castOf(db, seriesId)).any) {
		throw new ScriptError('Nothing to fill: every field on this page is written.');
	}
	startHelp(s, 'script.fill', HELP_PAGE, pageId, guidance, { pageId });
}

/** New panels asked for when a page has none. */
const NEW_PANELS = 4;

function fillMessage(
	s: ScriptState,
	page: ScriptPage,
	blanks: ReturnType<typeof blanksOf>,
	cast: Cast,
	guidance: string
): string {
	const i = s.layout.pages.findIndex((p) => p.id === page.id);
	const lines = [
		...helpContext(s, cast),
		...beatLines(s, page.beat, cast),
		`This page: page ${i + 1} of the chapter${page.turn ? '; a reveal lands as the reader turns to it' : ''}`,
		`Page purpose: ${page.purpose || '(blank)'}`,
		...neighborLine('The page before', s.layout.pages[i - 1]),
		...neighborLine('The page after', s.layout.pages[i + 1])
	];
	if (page.panels.length) {
		lines.push(
			"Panels on this page, in reading order. Fill only the blanks of the panels listed by id; the words are the writer's, for you to fit the staging to:"
		);
		for (const pid of page.panels) {
			const panel = parsePanel(s.current.get(panelKey(pid))?.text);
			const staging = stagingLine(panel, cast) || 'nothing written yet';
			const blank = blanks.panels.get(pid);
			lines.push(
				blank
					? `- panel ${pid}: ${staging}; blank: ${blank.join(', ')}`
					: `- a written panel (leave it): ${staging}`
			);
			const words = wordsLine(parseWords(s.current.get(wordsKey(pid))?.text), cast);
			if (words) lines.push(`  its words: ${words}`);
		}
	} else {
		lines.push(`New panels: ${NEW_PANELS}`);
	}
	lines.push(...feedbackLine(guidance));
	return lines.join('\n');
}

const fillHandler: JobHandler = async (job, { db, ai, signal }) => {
	const p = job.payload as HelpPayload & { pageId: string };
	const version = helpVersion(db, p.versionId);
	if (!version) return;
	const s = load(db, job.userId, p.seriesId, p.chapterId);
	const cast = castOf(db, p.seriesId);
	const page = s.layout.pages.find((pg) => pg.id === p.pageId);
	if (!page) return abandonVersion(db, version.id);
	const asked = blanksOf(s, page, cast);
	if (!asked.any) {
		finishVersion(db, version.id, { text: 'Nothing to fill: you wrote every field meanwhile.' });
		return;
	}
	const {
		value: reply,
		prompt,
		run: record
	} = await askJson(
		ai,
		'script.fill',
		[{ role: 'user', content: fillMessage(s, page, asked, cast, version.guidance) }],
		fillReply,
		signal
	);
	const runHash = await putRun(db, record);
	const stamp: AiStamp = { model: ai.text.name, ...prompt, runHash };

	// Again, now: fill only what was asked for and is still blank.
	if (!helpVersion(db, version.id)) return;
	const now = load(db, job.userId, p.seriesId, p.chapterId);
	const current = now.layout.pages.find((pg) => pg.id === p.pageId);
	if (!current) return abandonVersion(db, version.id);
	db.transaction(() => {
		const next: ScriptPage = { ...current, panels: [...current.panels] };
		let filled = 0;
		if (asked.purpose && !current.purpose.trim() && reply.purpose.trim()) {
			next.purpose = clip(reply.purpose, 300);
			filled++;
		}
		if (asked.newPanels && current.panels.length === 0) {
			for (const r of reply.panels.slice(0, MAX_PANELS)) {
				const pid = newId();
				const panel = newAiPanel(draftPanel(r, cast));
				writeAi(now, 'panel', pid, panelText(panel), stamp);
				next.panels.push(pid);
				filled += panel.ai.length;
			}
		}
		for (const r of reply.panels) {
			const fields = asked.panels.get(r.id);
			if (!fields || !current.panels.includes(r.id)) continue;
			const panel = parsePanel(now.current.get(panelKey(r.id))?.text);
			const draft = draftPanel(r, cast);
			const add = fields.filter((f) => isBlank(panel, f) && !isBlank(draft, f));
			if (!add.length) continue;
			const out: Panel = { ...panel, ai: [...panel.ai] };
			for (const f of add) {
				Object.assign(out, { [f]: draft[f] });
				if (!out.ai.includes(f)) out.ai.push(f);
			}
			out.ai = STAGING_FIELDS.filter((f) => out.ai.includes(f));
			writeAi(now, 'panel', r.id, panelText(out), stamp);
			filled += add.length;
		}
		if (next.purpose !== current.purpose || next.panels.length !== current.panels.length) {
			writeAiLayout(
				now,
				now.layout.pages.map((pg) => (pg.id === next.id ? next : pg)),
				stamp
			);
		}
		finishVersion(db, version.id, {
			text: filled
				? `Filled ${filled} blank${filled === 1 ? '' : 's'}.`
				: 'Nothing was filled: every blank was written meanwhile, or the AI left it.',
			notes: reply.notes,
			...stamp
		});
	});
};

export const scriptJobHandlers: Record<string, JobHandler> = {
	'script.layout': layoutHandler,
	'script.fill': fillHandler
};
