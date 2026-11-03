import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import {
	items,
	locations,
	series,
	versions,
	type ColorMode,
	type Item,
	type Location,
	type Series,
	type Version
} from './db/schema';
import { randomSeed } from './ai/image';
import { putImage, readAsset } from './assets';
import { enqueue, type JobHandler } from './jobs';
import { ownedSeries, touchSeries } from './series';
import {
	COLOR_MODES,
	compilePrompt,
	drawingStyle,
	positiveOnly,
	sentence,
	TONE_REMINDER,
	toneOnly,
	type DrawingStyle
} from './styles';
import {
	abandonVersion,
	addVersion,
	attachJob,
	currentVersions,
	deleteScope,
	describeScope,
	dropPending,
	ensureItem,
	finishVersion,
	startVersion,
	VersionError,
	type Access,
	type ItemView
} from './versions';

export class LocationError extends Error {}

/**
 * A location follows the same pipeline as a character, with a place's
 * profile in place of a person's:
 *
 *   your notes → profile → designs → design pictures → reference → sheet
 *
 * The reference is the user's choice of a design picture; the sheet redraws
 * it from other angles and at other times of day, so panels can set a scene
 * there from any direction.
 */
export const locationScope = (locationId: number) => `location:${locationId}`;

/** What the AI writes into the profile from the user's notes. */
export const PROFILE_KINDS = [
	'name',
	'purpose',
	'history',
	'atmosphere',
	'setting',
	'appearance',
	'details'
] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const PROFILE_LABELS: Record<ProfileKind, string> = {
	name: 'Name',
	purpose: 'Role in the story',
	history: 'History',
	atmosphere: 'Atmosphere',
	setting: 'What and where',
	appearance: 'Layout and architecture',
	details: 'Details and props'
};

/** The profile fields the image model draws from. */
const LOOK_KINDS = ['setting', 'appearance', 'details'] as const;

export function isProfileKind(value: string): value is ProfileKind {
	return (PROFILE_KINDS as readonly string[]).includes(value);
}

/** Text the user may save: their own notes, and any profile field. */
export type TextKind = 'brief' | ProfileKind;

export function isTextKind(value: string): value is TextKind {
	return value === 'brief' || isProfileKind(value);
}

/** The design slots: each holds a design (text) and its picture. */
export const DESIGN_KEYS = ['1', '2', '3', '4'] as const;
export type DesignKey = (typeof DESIGN_KEYS)[number];
export const CANDIDATE_COUNT = DESIGN_KEYS.length;

export function isDesignKey(value: string): value is DesignKey {
	return (DESIGN_KEYS as readonly string[]).includes(value);
}

/** Wide landscape (about 16:9, one megapixel): an establishing shot. */
export const CANDIDATE_SIZE = { width: 1344, height: 768 };

/** One design: a short label and the look the image model draws. */
export interface Design {
	label: string;
	appearance: string;
	details: string;
}

const designSchema = z.object({
	label: z.string().default(''),
	appearance: z.string().default(''),
	details: z.string().default('')
});

export function parseDesign(text: string | undefined): Design | null {
	if (!text) return null;
	try {
		return designSchema.parse(JSON.parse(text));
	} catch {
		return null;
	}
}

const designText = (d: Design) =>
	JSON.stringify({ label: d.label, appearance: d.appearance, details: d.details });

/** The stages of the pipeline the AI regenerates. */
export const STAGES = ['profile', 'designs', 'pictures', 'sheet'] as const;
export type Stage = (typeof STAGES)[number];

/** Names of inputs, to say why something is out of date. */
const INPUT_LABELS: Record<string, string> = {
	brief: 'your notes',
	setting: 'what and where',
	appearance: 'the layout',
	details: 'the details',
	design: 'the design',
	style: 'the style prompt',
	color: 'the color mode',
	model: 'the image model',
	reference: 'the reference picture'
};

const uncapitalize = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The full image prompt for a design picture of a location: a wide,
 * empty establishing shot. Like the style's place samples, it says "empty"
 * and "No people", since genre words in a style otherwise put people in it.
 */
export function locationPrompt(
	style: Pick<DrawingStyle, 'colorMode' | 'prompt'>,
	look: { setting: string; appearance: string; details: string },
	guidance = ''
): string {
	const what = uncapitalize(look.setting.trim()) || 'one place';
	const subject = [
		`Wide establishing shot of ${what}, empty, background art for a comic.`,
		sentence(look.appearance),
		look.details.trim() ? sentence(`With ${uncapitalize(look.details.trim())}`) : '',
		sentence(positiveOnly(guidance)),
		'No people.',
		TONE_REMINDER[style.colorMode]
	]
		.filter(Boolean)
		.join(' ');
	return compilePrompt(style, subject);
}

const KEEP =
	'Keep the same place exactly: the same architecture, layout, materials, furnishings and landmarks, adding nothing and no people. Keep the same drawing style, line work and shading.';

/**
 * The location sheet: the reference redrawn with the edit model from other
 * angles and at other times of day, so panels can set a scene there from any
 * direction and at any hour.
 */
export const SHEET_VIEWS = [
	{
		key: 'reverse',
		label: 'Reverse angle',
		instruction: 'Show this same place from the opposite direction, looking back the other way.'
	},
	{
		key: 'eye-level',
		label: 'Eye level',
		instruction: 'Show this place from the eye level of someone standing in it.'
	},
	{
		key: 'high',
		label: 'High angle',
		instruction: 'Show this place from high above, looking down on its whole layout.'
	},
	{
		key: 'detail',
		label: 'Detail',
		instruction: 'Close-up of one characteristic detail of this place.'
	},
	{ key: 'morning', label: 'Morning', instruction: 'The same view in early morning light.' },
	{
		key: 'dusk',
		label: 'Dusk',
		instruction: 'The same view at dusk, with long shadows and evening light.'
	},
	{
		key: 'night',
		label: 'Night',
		instruction: 'The same view at night, lit by its own lamps and the moon.'
	},
	{ key: 'rain', label: 'Rain', instruction: 'The same view in heavy rain.' }
] as const;

export type SheetView = (typeof SHEET_VIEWS)[number]['key'];

export function isSheetView(value: string): value is SheetView {
	return SHEET_VIEWS.some((v) => v.key === value);
}

/** The edit instruction for one sheet view, with the user's guidance for that redraw. */
export function sheetPrompt(
	colorMode: ColorMode,
	view: SheetView,
	guidance = '',
	what = ''
): string {
	const { instruction } = SHEET_VIEWS.find((v) => v.key === view)!;
	return toneOnly(
		colorMode,
		[
			what.trim() ? sentence(`The place is ${uncapitalize(what.trim())}`) : '',
			instruction,
			sentence(guidance),
			KEEP,
			'No people.',
			TONE_REMINDER[colorMode]
		]
			.filter(Boolean)
			.join(' ')
	);
}

// ---------------------------------------------------------------------------
// State: the current version of every item, and what each is made from

interface LocationState {
	location: Location;
	series: Series;
	/** The series' style, ready or not: the AI's context for the setting. */
	context: DrawingStyle | undefined;
	/** The series' style once it can draw (it has a prompt and a sample). */
	ready: DrawingStyle | undefined;
	current: Map<string, Version>;
}

function stateOf(db: Db, location: Location, owner: Series): LocationState {
	const context = owner.styleId ? drawingStyle(db, owner.styleId) : undefined;
	return {
		location,
		series: owner,
		context,
		ready: context?.ready ? context : undefined,
		current: currentVersions(db, locationScope(location.id))
	};
}

const textOf = (s: LocationState, slot: string) => s.current.get(slot)?.text ?? '';

const profileInputs = (s: LocationState) => ({ brief: textOf(s, 'brief') });

const lookInputs = (s: LocationState) => ({
	brief: textOf(s, 'brief'),
	setting: textOf(s, 'setting'),
	appearance: textOf(s, 'appearance'),
	details: textOf(s, 'details')
});

const styleInputs = (s: LocationState) => ({
	style: String(s.ready?.promptVersionId ?? ''),
	color: s.ready?.colorMode ?? '',
	model: s.ready?.model ?? ''
});

const pictureInputs = (s: LocationState, key: string) => ({
	design: textOf(s, `design:${key}`),
	setting: textOf(s, 'setting'),
	...styleInputs(s)
});

const referenceInputs = (s: LocationState) => ({ ...lookInputs(s), ...styleInputs(s) });

const sheetInputs = (s: LocationState) => ({
	reference: String(s.current.get('reference')?.id ?? ''),
	color: s.context?.colorMode ?? ''
});

/** What a new version of an item would be made from; null for the user's own inputs. */
function inputsFor(s: LocationState, item: Pick<Item, 'kind' | 'key'>) {
	if (isProfileKind(item.kind)) return profileInputs(s);
	if (item.kind === 'design') return lookInputs(s);
	if (item.kind === 'picture') return pictureInputs(s, item.key);
	if (item.kind === 'reference') return referenceInputs(s);
	if (item.kind === 'sheet') return sheetInputs(s);
	return null;
}

/** The items each item is made from, as slot keys. */
function upstreamOf(item: Pick<Item, 'kind' | 'key'>): string[] {
	if (item.kind === 'design') return [...LOOK_KINDS];
	if (item.kind === 'picture') return [`design:${item.key}`, 'setting'];
	if (item.kind === 'reference') return [...LOOK_KINDS];
	if (item.kind === 'sheet') return ['reference'];
	return [];
}

/** Where an item stands; see the character pipeline. */
export type Status = 'missing' | 'pending' | 'outdated' | 'upstream' | 'ok';

function statuses(views: Map<string, ItemView>) {
	const memo = new Map<string, Status>();
	const view = (slot: string) => views.get(slot);
	/** Locked items, and the reference, which only the user chooses. */
	const anchored = (slot: string) =>
		Boolean(view(slot)?.locked) || (slot === 'reference' && Boolean(view(slot)?.currentId));
	const status = (slot: string): Status => {
		const known = memo.get(slot);
		if (known) return known;
		const v = view(slot);
		const [kind, key = ''] = slot.split(':');
		let result: Status;
		const current = v?.versions.find((x) => x.id === v.currentId);
		if (v?.pending) result = 'pending';
		else if (!current) result = 'missing';
		else if (current.outOfDate.length) result = 'outdated';
		else {
			const changing = upstreamOf({ kind, key }).some((u) => !anchored(u) && status(u) !== 'ok');
			result = changing ? 'upstream' : 'ok';
		}
		memo.set(slot, result);
		return result;
	};
	/** Every earlier step is settled: locked, or up to date. */
	const settled = (slot: string) => {
		const [kind, key = ''] = slot.split(':');
		return upstreamOf({ kind, key }).every((u) => anchored(u) || status(u) === 'ok');
	};
	return { status, settled };
}

/** Slots that can be regenerated now: unlocked, missing or out of date, with earlier steps settled. */
function dueSlots(db: Db, s: LocationState, stage: Stage): string[] {
	const views = describeScope(db, locationScope(s.location.id), (i) => inputsFor(s, i), {});
	const { status, settled } = statuses(views);
	const due = (slot: string) => {
		if (views.get(slot)?.locked) return false;
		const st = status(slot);
		return (st === 'missing' || st === 'outdated') && settled(slot);
	};
	if (stage === 'profile') {
		if (!textOf(s, 'brief') && !s.location.name) return [];
		return PROFILE_KINDS.filter((k) => due(k));
	}
	if (stage === 'designs') {
		if (!s.context || !textOf(s, 'appearance')) return [];
		return DESIGN_KEYS.map((k) => `design:${k}`).filter(due);
	}
	if (stage === 'pictures') {
		if (!s.ready) return [];
		return DESIGN_KEYS.filter((k) => s.current.get(`design:${k}`))
			.map((k) => `picture:${k}`)
			.filter(due);
	}
	if (!s.ready || !s.current.get('reference')?.assetHash) return [];
	return SHEET_VIEWS.map((v) => `sheet:${v.key}`).filter(due);
}

// ---------------------------------------------------------------------------
// Queries

function ownedLocation(db: Db, ownerId: number, locationId: number) {
	const row = db
		.select({ location: locations, series })
		.from(locations)
		.innerJoin(series, eq(locations.seriesId, series.id))
		.where(eq(locations.id, locationId))
		.get();
	if (!row || row.series.ownerId !== ownerId) throw new LocationError('Location not found.');
	return row;
}

function loadState(db: Db, locationId: number): LocationState | undefined {
	const row = db
		.select({ location: locations, series })
		.from(locations)
		.innerJoin(series, eq(locations.seriesId, series.id))
		.where(eq(locations.id, locationId))
		.get();
	return row ? stateOf(db, row.location, row.series) : undefined;
}

function ownedState(db: Db, ownerId: number, locationId: number): LocationState {
	const { location, series: owner } = ownedLocation(db, ownerId, locationId);
	return stateOf(db, location, owner);
}

/** Who may change a location's items. */
export function locationAccess(db: Db, ownerId: number, locationId: number): Access {
	ownedLocation(db, ownerId, locationId);
	return { ownerId, scope: locationScope(locationId) };
}

/** The current reference version of each location. */
export function locationReferences(db: Db, locationIds: number[]): Map<number, Version> {
	const out = new Map<number, Version>();
	if (!locationIds.length) return out;
	const rows = db
		.select({ scope: items.scope, version: versions })
		.from(items)
		.innerJoin(versions, eq(versions.id, items.currentVersionId))
		.where(
			and(
				eq(items.kind, 'reference'),
				inArray(
					items.scope,
					locationIds.map((id) => locationScope(id))
				)
			)
		)
		.all();
	for (const r of rows) out.set(Number(r.scope.split(':')[1]), r.version);
	return out;
}

/**
 * The series' default location: the one the user chose, or else the first
 * made. Undefined while the series has none.
 */
export function defaultLocationId(db: Db, owner: Series): number | undefined {
	const all = db
		.select({ id: locations.id })
		.from(locations)
		.where(eq(locations.seriesId, owner.id))
		.orderBy(asc(locations.id))
		.all();
	return all.find((l) => l.id === owner.defaultLocationId)?.id ?? all[0]?.id;
}

export function listLocations(db: Db, ownerId: number, seriesId: number) {
	const owner = ownedSeries(db, ownerId, seriesId);
	const all = db
		.select()
		.from(locations)
		.where(eq(locations.seriesId, seriesId))
		.orderBy(locations.id)
		.all();
	const refs = locationReferences(
		db,
		all.map((l) => l.id)
	);
	const fallback = defaultLocationId(db, owner);
	return all.map((l) => ({
		...l,
		thumb: refs.get(l.id)?.thumbHash ?? null,
		hasReference: refs.has(l.id),
		isDefault: l.id === fallback
	}));
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

export function getLocation(db: Db, ownerId: number, locationId: number) {
	const s = ownedState(db, ownerId, locationId);
	const views = describeScope(
		db,
		locationScope(locationId),
		(item) => inputsFor(s, item),
		INPUT_LABELS
	);
	const { status } = statuses(views);
	const view = (kind: string, key = '') =>
		views.get(key ? `${kind}:${key}` : kind) ?? emptyView(kind, key);
	const all = [...views.values()];
	const due = Object.fromEntries(STAGES.map((st) => [st, dueSlots(db, s, st).length])) as Record<
		Stage,
		number
	>;
	// The AI's latest notes on the profile.
	const notes =
		PROFILE_KINDS.map((k) => s.current.get(k))
			.filter((v): v is Version => Boolean(v?.notes))
			.sort((a, b) => b.id - a.id)[0]?.notes ?? '';
	const profileItems = PROFILE_KINDS.map((kind) => ({
		kind,
		label: PROFILE_LABELS[kind],
		item: view(kind),
		status: status(kind)
	}));
	const sheet = SHEET_VIEWS.map((v) => ({
		view: v.key,
		label: v.label,
		item: view('sheet', v.key),
		status: status(`sheet:${v.key}`)
	}));
	const designs = DESIGN_KEYS.map((key) => ({
		key,
		design: view('design', key),
		designStatus: status(`design:${key}`),
		picture: view('picture', key),
		pictureStatus: status(`picture:${key}`)
	}));
	/** Where a step of the pipeline stands, over its items. */
	const summary = (slots: string[]) => {
		const of = (want: Status[]) => slots.filter((slot) => want.includes(status(slot)));
		return {
			total: slots.length,
			pending: of(['pending']).length,
			missing: of(['missing']).length,
			/** Unlocked, and out of date now or once an earlier step is redone. */
			stale: of(['outdated', 'upstream']).filter((slot) => !views.get(slot)?.locked).length,
			kept: slots.filter((slot) => views.get(slot)?.locked).length
		};
	};
	return {
		location: s.location,
		series: s.series,
		isDefault: defaultLocationId(db, s.series) === s.location.id,
		style: s.ready ?? null,
		hasStyle: Boolean(s.context),
		brief: view('brief'),
		notes,
		profile: profileItems,
		designs,
		traits: s.location.designTraits,
		reference: { item: view('reference'), status: status('reference') },
		sheet,
		/** Items that can be regenerated now, by stage. */
		due,
		/** The pipeline, step by step, for the diagram. */
		flow: {
			notes: summary(['brief']),
			profile: summary([...PROFILE_KINDS]),
			designs: summary(DESIGN_KEYS.map((k) => `design:${k}`)),
			pictures: summary(DESIGN_KEYS.map((k) => `picture:${k}`)),
			reference: summary(['reference']),
			sheet: summary(SHEET_VIEWS.map((v) => `sheet:${v.key}`))
		},
		developing: profileItems.some((p) => p.item.pending),
		designing: designs.some((d) => d.design.pending),
		busy: all.some((v) => v.pending)
	};
}

export type LocationDetail = ReturnType<typeof getLocation>;

// ---------------------------------------------------------------------------
// Commands

/** Turn a VersionError into a LocationError the page shows. */
function run<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof VersionError) throw new LocationError(e.message);
		throw e;
	}
}

const item = (db: Db, s: LocationState, kind: string, key = '') =>
	ensureItem(db, s.series.ownerId, locationScope(s.location.id), kind, key);

/** Copy the current name to the location row, for lists. */
export function syncLocation(db: Db, locationId: number): void {
	const current = currentVersions(db, locationScope(locationId));
	db.update(locations)
		.set({ name: current.get('name')?.text ?? '', updatedAt: new Date() })
		.where(eq(locations.id, locationId))
		.run();
}

export interface NewLocation {
	name: string;
	brief: string;
}

/**
 * Add a location to a series and ask the AI to develop a profile from the
 * notes, then write designs from it. A name the user gives is locked.
 */
export function createLocation(
	db: Db,
	ownerId: number,
	seriesId: number,
	input: NewLocation
): number {
	const owner = ownedSeries(db, ownerId, seriesId);
	const name = input.name.trim();
	const brief = input.brief.trim();
	if (!name && !brief) throw new LocationError('Give the location a name or a description.');
	const now = new Date();
	const location = db
		.insert(locations)
		.values({ seriesId, name, seed: randomSeed(), createdAt: now, updatedAt: now })
		.returning()
		.get();
	const scope = locationScope(location.id);
	if (brief)
		addVersion(db, ensureItem(db, ownerId, scope, 'brief'), { origin: 'user', text: brief });
	if (name) {
		const s = stateOf(db, location, owner);
		addVersion(
			db,
			ensureItem(db, ownerId, scope, 'name'),
			{ origin: 'user', text: name, inputs: profileInputs(s) },
			{ keep: true }
		);
	}
	touchSeries(db, seriesId);
	updateOutdated(db, ownerId, location.id, ['profile', 'designs']);
	return location.id;
}

/** Make a location the series' default. */
export function setDefaultLocation(db: Db, ownerId: number, locationId: number): void {
	const { location } = ownedLocation(db, ownerId, locationId);
	db.update(series)
		.set({ defaultLocationId: location.id, updatedAt: new Date() })
		.where(eq(series.id, location.seriesId))
		.run();
}

/**
 * Save the user's own wording of a text field as a new version, if it
 * changed. A profile field the user writes is locked unless `keep` is false.
 * Nothing downstream is regenerated: it is marked out of date.
 */
export function saveText(
	db: Db,
	ownerId: number,
	locationId: number,
	kind: TextKind,
	text: string,
	keep = true
): void {
	const s = ownedState(db, ownerId, locationId);
	const value = text.trim();
	if (kind === 'name' && !value) throw new LocationError('Give the location a name.');
	const it = item(db, s, kind);
	const generated = isProfileKind(kind);
	const visual = kind === 'appearance' || kind === 'details' || kind === 'setting';
	const final = visual ? positiveOnly(value) : value;
	if (final === textOf(s, kind)) {
		if (generated && it.currentVersionId !== null && it.locked !== keep) {
			db.update(items).set({ locked: keep }).where(eq(items.id, it.id)).run();
			if (keep) dropPending(db, [it.id]);
		}
		return;
	}
	addVersion(
		db,
		it,
		{ origin: 'user', text: final, inputs: inputsFor(s, it) ?? {} },
		generated ? { keep } : {}
	);
	if (kind === 'name') syncLocation(db, locationId);
	touchSeries(db, s.series.id);
}

/** Save the user's version of one design, locked unless `keep` is false. */
export function saveDesign(
	db: Db,
	ownerId: number,
	locationId: number,
	key: string,
	design: Design,
	keep = true
): void {
	if (!isDesignKey(key)) throw new LocationError('Unknown design.');
	const s = ownedState(db, ownerId, locationId);
	const clean = {
		label: design.label.trim(),
		appearance: positiveOnly(design.appearance.trim()),
		details: positiveOnly(design.details.trim())
	};
	if (!clean.appearance) throw new LocationError('Describe how this design looks.');
	const it = item(db, s, 'design', key);
	const text = designText(clean);
	if (text === textOf(s, `design:${key}`)) {
		if (it.locked !== keep) {
			db.update(items).set({ locked: keep }).where(eq(items.id, it.id)).run();
			if (keep) dropPending(db, [it.id]);
		}
		return;
	}
	addVersion(db, it, { origin: 'user', text, inputs: lookInputs(s) }, { keep });
}

/** Options for the jobs a request starts. */
interface Start {
	guidance?: string;
	seed?: number | null;
	cascade?: Stage[];
}

function startProfile(db: Db, s: LocationState, kinds: ProfileKind[], opts: Start = {}): number {
	if (!kinds.length) return 0;
	const started = run(() =>
		kinds.map((k) => [k, startVersion(db, item(db, s, k), { guidance: opts.guidance }).id] as const)
	);
	const job = enqueue(db, s.series.ownerId, 'location.develop', {
		locationId: s.location.id,
		versionIds: Object.fromEntries(started),
		guidance: opts.guidance?.trim() ?? '',
		cascade: opts.cascade ?? []
	});
	attachJob(
		db,
		started.map(([, id]) => id),
		job.id
	);
	return started.length;
}

function startDesigns(db: Db, s: LocationState, keys: DesignKey[], opts: Start = {}): number {
	if (!keys.length) return 0;
	if (!s.context) throw new LocationError('Describe the series’ style first.');
	if (!textOf(s, 'appearance')) throw new LocationError('Describe how the location looks first.');
	const started = run(() =>
		keys.map(
			(k) =>
				[k, startVersion(db, item(db, s, 'design', k), { guidance: opts.guidance }).id] as const
		)
	);
	const job = enqueue(db, s.series.ownerId, 'location.designs', {
		locationId: s.location.id,
		versionIds: Object.fromEntries(started),
		guidance: opts.guidance?.trim() ?? '',
		cascade: opts.cascade ?? []
	});
	attachJob(
		db,
		started.map(([, id]) => id),
		job.id
	);
	return started.length;
}

const NO_STYLE = 'Draw at least one sample picture of the series’ style before drawing locations.';

/**
 * Draw design pictures. Each keeps the seed of its current version when its
 * design or the style changed, so the new picture shows what the change did;
 * regenerating an up-to-date picture uses a new seed.
 */
function startPictures(db: Db, s: LocationState, keys: DesignKey[], opts: Start = {}): number {
	if (!keys.length) return 0;
	if (!s.ready) throw new LocationError(NO_STYLE);
	const views = describeScope(db, locationScope(s.location.id), (i) => inputsFor(s, i), {});
	return run(
		() =>
			keys.map((key) => {
				if (!s.current.get(`design:${key}`)) throw new LocationError('Write the design first.');
				const current = s.current.get(`picture:${key}`);
				const view = views.get(`picture:${key}`);
				const outOfDate = view?.versions.find((v) => v.id === view.currentId)?.outOfDate.length;
				const seed =
					opts.seed ??
					(current && !outOfDate
						? randomSeed()
						: (current?.seed ?? s.location.seed + DESIGN_KEYS.indexOf(key)));
				const version = startVersion(db, item(db, s, 'picture', key), {
					seed,
					guidance: opts.guidance
				});
				const job = enqueue(db, s.series.ownerId, 'location.picture', {
					locationId: s.location.id,
					versionId: version.id,
					key,
					cascade: opts.cascade ?? []
				});
				attachJob(db, [version.id], job.id);
				return version;
			}).length
	);
}

function startSheet(db: Db, s: LocationState, views: SheetView[], opts: Start = {}): number {
	if (!views.length) return 0;
	if (!s.ready) throw new LocationError(NO_STYLE);
	if (!s.current.get('reference')?.assetHash) {
		throw new LocationError('Choose a reference picture first.');
	}
	const seed = opts.seed ?? randomSeed();
	return run(
		() =>
			views.map((view, i) => {
				const version = startVersion(db, item(db, s, 'sheet', view), {
					seed: seed + i,
					guidance: opts.guidance
				});
				const job = enqueue(db, s.series.ownerId, 'location.sheet', {
					locationId: s.location.id,
					versionId: version.id,
					view
				});
				attachJob(db, [version.id], job.id);
				return version;
			}).length
	);
}

/**
 * Regenerate what is missing or out of date and unlocked, in the given
 * stages, as far as the pipeline allows now. Returns how many items started.
 */
export function updateOutdated(
	db: Db,
	ownerId: number,
	locationId: number,
	stages: readonly Stage[] = STAGES
): number {
	ownedLocation(db, ownerId, locationId);
	return advance(db, locationId, stages);
}

const after = (stage: Stage, cascade: Stage[]) =>
	cascade.filter((st) => STAGES.indexOf(st) > STAGES.indexOf(stage));

function advance(db: Db, locationId: number, stages: readonly Stage[]): number {
	const s = loadState(db, locationId);
	if (!s) return 0;
	const cascade = [...stages];
	let started = 0;
	for (const stage of stages) {
		const due = dueSlots(db, s, stage);
		const keys = due.map((slot) => slot.split(':')[1] ?? slot);
		if (stage === 'profile') started += startProfile(db, s, due as ProfileKind[], { cascade });
		if (stage === 'designs') started += startDesigns(db, s, keys as DesignKey[], { cascade });
		if (stage === 'pictures') started += startPictures(db, s, keys as DesignKey[], { cascade });
		if (stage === 'sheet') {
			for (const view of keys as SheetView[]) {
				started += startSheet(db, s, [view], {
					guidance: s.current.get(`sheet:${view}`)?.guidance ?? ''
				});
			}
		}
	}
	return started;
}

/** Ask the AI to rewrite profile fields (all unlocked, or the ones given). */
export function requestProfile(
	db: Db,
	ownerId: number,
	locationId: number,
	opts: { kinds?: ProfileKind[]; guidance?: string } = {}
): number {
	const s = ownedState(db, ownerId, locationId);
	const views = describeScope(db, locationScope(locationId), () => null, {});
	const kinds = opts.kinds ?? PROFILE_KINDS.filter((k) => !views.get(k)?.locked);
	if (!kinds.length) throw new LocationError('Every field is locked.');
	return startProfile(db, s, kinds, { guidance: opts.guidance });
}

/** Ask the AI for new designs (all unlocked, or the ones given), then draw their pictures. */
export function requestDesigns(
	db: Db,
	ownerId: number,
	locationId: number,
	opts: { keys?: DesignKey[]; guidance?: string } = {}
): number {
	const s = ownedState(db, ownerId, locationId);
	const views = describeScope(db, locationScope(locationId), () => null, {});
	const keys = opts.keys ?? DESIGN_KEYS.filter((k) => !views.get(`design:${k}`)?.locked);
	if (!keys.length) throw new LocationError('Every design is locked.');
	return startDesigns(db, s, keys, { guidance: opts.guidance, cascade: ['pictures'] });
}

/** Draw design pictures: the ones given, or every unlocked one that has a design. */
export function requestPictures(
	db: Db,
	ownerId: number,
	locationId: number,
	opts: { keys?: DesignKey[]; guidance?: string; seed?: number | null } = {}
): number {
	const s = ownedState(db, ownerId, locationId);
	if (!s.ready) throw new LocationError(NO_STYLE);
	const views = describeScope(db, locationScope(locationId), () => null, {});
	const keys =
		opts.keys ??
		DESIGN_KEYS.filter((k) => s.current.get(`design:${k}`) && !views.get(`picture:${k}`)?.locked);
	return startPictures(db, s, keys, { guidance: opts.guidance, seed: opts.seed });
}

/** Redraw sheet views from the reference: every unlocked view, or just one. */
export function requestSheet(
	db: Db,
	ownerId: number,
	locationId: number,
	only?: SheetView,
	guidance = '',
	seed: number | null = null
): number {
	const s = ownedState(db, ownerId, locationId);
	if (only) return startSheet(db, s, [only], { guidance, seed });
	const views = describeScope(db, locationScope(locationId), () => null, {});
	return startSheet(
		db,
		s,
		SHEET_VIEWS.map((v) => v.key).filter((v) => !views.get(`sheet:${v}`)?.locked),
		{ guidance }
	);
}

/** Stop drawing the sheet: cancel the views not drawn yet. */
export function stopSheet(db: Db, ownerId: number, locationId: number): void {
	const s = ownedState(db, ownerId, locationId);
	dropPending(
		db,
		SHEET_VIEWS.map((v) => item(db, s, 'sheet', v.key).id)
	);
}

/**
 * Make a design picture (any version of it) the location's reference: a new
 * version of the reference item, recording the design and profile it was made
 * from, so it is out of date when they change.
 */
export function chooseReference(
	db: Db,
	ownerId: number,
	locationId: number,
	pictureVersionId: number
): void {
	const s = ownedState(db, ownerId, locationId);
	const row = db
		.select({ version: versions, item: items })
		.from(versions)
		.innerJoin(items, eq(items.id, versions.itemId))
		.where(eq(versions.id, pictureVersionId))
		.get();
	if (
		!row ||
		row.item.scope !== locationScope(locationId) ||
		row.item.kind !== 'picture' ||
		row.version.status !== 'ready' ||
		!row.version.assetHash
	) {
		throw new LocationError('That picture is not ready.');
	}
	const picture = row.version;
	if (s.current.get('reference')?.assetHash === picture.assetHash) return;
	const design = picture.inputs.design ?? '';
	const designItem = item(db, s, 'design', row.item.key);
	const designVersion = db
		.select()
		.from(versions)
		.where(and(eq(versions.itemId, designItem.id), eq(versions.text, design)))
		.all()
		.at(-1);
	addVersion(db, item(db, s, 'reference'), {
		origin: 'user',
		text: design,
		assetHash: picture.assetHash,
		thumbHash: picture.thumbHash,
		seed: picture.seed,
		inputs: {
			...(designVersion?.inputs ?? {}),
			style: picture.inputs.style ?? '',
			color: picture.inputs.color ?? '',
			model: picture.inputs.model ?? ''
		}
	});
	// Views still being drawn are from the old reference: stop them.
	dropPending(
		db,
		SHEET_VIEWS.map((v) => item(db, s, 'sheet', v.key).id)
	);
	touchSeries(db, s.series.id);
}

/** Delete a location. If it was the default, the first remaining one becomes it. */
export function deleteLocation(db: Db, ownerId: number, locationId: number): void {
	const { location, series: owner } = ownedLocation(db, ownerId, locationId);
	deleteScope(db, locationScope(locationId));
	db.delete(locations).where(eq(locations.id, locationId)).run();
	if (owner.defaultLocationId === locationId) {
		db.update(series).set({ defaultLocationId: null }).where(eq(series.id, owner.id)).run();
	}
	touchSeries(db, location.seriesId);
}

// ---------------------------------------------------------------------------
// Jobs

const DEVELOP_SYSTEM = `You are an experienced manga background artist and location scout, helping someone who may be new to comics design the recurring places of a short manga (under 30 pages).

Develop the location from the user's notes into a profile. Keep everything the user has decided; fill gaps with choices that suit the story, its setting and era. Make the place distinct from the series' other locations, so readers know at a glance where a scene is, even in black and white.

Reply with only a JSON object with these keys (all strings):
- "name": a short name for the place, as the characters would call it.
- "purpose": what happens here in the story and why it matters; one or two sentences.
- "history": one or two sentences of history that shows in the place.
- "atmosphere": the mood, light, sounds and smells, in one or two sentences.
- "setting": a short phrase saying what and where the place is, with its era, for example "a cramped ramen shop in 1980s Osaka".
- "appearance": 25 to 60 words an image model can draw: the layout, scale, architecture, materials and landmarks. Visible only; no story.
- "details": 15 to 40 words: the furnishings, props, signs and textures that make it recognizable.
- "notes": two or three plain-language sentences to the user about the choices you made and what they might decide next.

Fields marked as kept are fixed: repeat them exactly, and make the rest fit them.

The image model reads negation as a request ("no cars" draws cars), so never write "no", "not" or "without" in "setting", "appearance" or "details": describe only what is there. Never put people in them.

When the manga is not in full color, describe materials and surfaces in tones (black, white, dark, pale, light gray) and patterns, never in hues: a word like "red" makes the image model paint in color.`;

const developReply = z.object({
	name: z.string().default(''),
	purpose: z.string().default(''),
	history: z.string().default(''),
	atmosphere: z.string().default(''),
	setting: z.string().default(''),
	appearance: z.string().default(''),
	details: z.string().default(''),
	notes: z.string().default('')
});

/** The other locations in the series, as the AI sees them. */
function placesOf(db: Db, s: LocationState) {
	return db
		.select()
		.from(locations)
		.where(eq(locations.seriesId, s.series.id))
		.all()
		.filter((l) => l.id !== s.location.id && l.name)
		.map((l) => {
			const current = currentVersions(db, locationScope(l.id));
			return {
				name: l.name,
				look: current.get('setting')?.text || current.get('brief')?.text || ''
			};
		});
}

export function developMessages(
	s: LocationState,
	places: { name: string; look: string }[],
	rewrite: ProfileKind[],
	guidance: string
) {
	const lines = [`Series title: ${s.series.title}`];
	if (s.series.logline) lines.push(`Logline: ${s.series.logline}`);
	if (s.context) {
		lines.push(
			`Setting and look of the series: ${s.context.description}`,
			`Color: ${COLOR_MODES[s.context.colorMode].label}`
		);
	}
	if (places.length) {
		lines.push('The series’ other locations:', ...places.map((p) => `- ${p.name}: ${p.look}`));
	}
	const brief = textOf(s, 'brief');
	if (brief) lines.push(`The user's notes on this location: ${brief}`);
	const kept = PROFILE_KINDS.filter((k) => !rewrite.includes(k) && textOf(s, k));
	if (kept.length) {
		lines.push('Kept (repeat exactly):', ...kept.map((k) => `- ${k}: ${textOf(s, k)}`));
	}
	const previous = rewrite.filter((k) => textOf(s, k));
	if (previous.length && guidance) {
		lines.push(
			'The current draft of the fields to rewrite:',
			...previous.map((k) => `- ${k}: ${textOf(s, k)}`)
		);
	}
	lines.push(
		guidance
			? `The user's feedback: ${guidance}`
			: previous.length
				? 'Write these fields afresh from the notes: ' + rewrite.join(', ') + '.'
				: 'Write the first version of the profile.'
	);
	return [
		{ role: 'system' as const, content: DEVELOP_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const developHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { locationId, versionIds, guidance, cascade } = job.payload as {
		locationId: number;
		versionIds: Partial<Record<ProfileKind, number>>;
		guidance: string;
		cascade: Stage[];
	};
	const s = loadState(db, locationId);
	if (!s) return; // deleted meanwhile
	const rewrite = PROFILE_KINDS.filter((k) => versionIds[k] !== undefined);
	const reply = await ai.text.json(
		developMessages(s, placesOf(db, s), rewrite, guidance),
		developReply,
		signal
	);
	const inputs = profileInputs(s);
	for (const kind of rewrite) {
		const id = versionIds[kind]!;
		const raw = reply[kind].trim();
		const text = (LOOK_KINDS as readonly string[]).includes(kind) ? positiveOnly(raw) : raw;
		if (text) finishVersion(db, id, { text, inputs, notes: reply.notes.trim() });
		else abandonVersion(db, id);
	}
	syncLocation(db, locationId);
	advance(db, locationId, after('profile', cascade));
};

const DESIGNS_SYSTEM = `You are an experienced manga background artist. You propose clearly different designs for one location, so the user can pick the look they like best.

Work in two steps.

First, sort the location's visible traits into fixed and free. A trait is fixed only when the user's own notes, the setting or the era decide it. Everything else is free. The draft layout and details were written by an AI, not the user: a trait that appears only in the draft is free. Consider at least: scale, layout and depth, viewpoint, architecture, materials, age and wear, clutter or emptiness, light sources, vegetation, weather, and one landmark that makes it recognizable.

Second, write the designs asked for, spread across the free traits, each clearly different from the others at a glance. When asked for the full set, the first design stays close to the current draft. New designs also differ from the designs the user is keeping. Every design keeps every fixed trait.

Reply with only a JSON object with these keys:
- "fixed": an array of short phrases, the traits that are fixed and what decides each.
- "free": an array of the free traits, each with the range of values the designs use, for example "scale: cramped / airy / cavernous / sprawling".
- "designs": an array of objects, each with these keys (all strings):
  - "label": three to six words that set the design apart, for example "narrow, cluttered, paper lanterns".
  - "appearance": 25 to 60 words an image model can draw: layout, scale, architecture, materials, landmarks. Visible only.
  - "details": 15 to 40 words: furnishings, props, signs and textures.

The image model reads negation as a request, so never write "no", "not" or "without" in a design, and never put people in one.

When the series is not in full color, describe materials and surfaces in tones (black, white, dark, pale, light gray) and patterns, never in hues.`;

const designsReply = z.object({
	fixed: z.array(z.string()).default([]),
	free: z.array(z.string()).default([]),
	designs: z.array(designSchema).default([])
});

export function designMessages(s: LocationState, count: number, others: Design[], guidance = '') {
	const style = s.context!;
	const lines = [
		`Series title: ${s.series.title}`,
		`Setting and look of the series: ${style.description}`,
		`Color: ${COLOR_MODES[style.colorMode].label}`,
		`Location: ${textOf(s, 'name') || s.location.name || 'unnamed'}`
	];
	const setting = textOf(s, 'setting');
	if (setting) lines.push(`What and where: ${setting}`);
	lines.push(
		`The user's own notes on this location (the only fixed traits besides setting and era): ${textOf(s, 'brief') || '(none)'}`
	);
	const purpose = textOf(s, 'purpose');
	if (purpose) lines.push(`Role in the story: ${purpose}`);
	const atmosphere = textOf(s, 'atmosphere');
	if (atmosphere) lines.push(`Atmosphere: ${atmosphere}`);
	const appearance = textOf(s, 'appearance');
	const details = textOf(s, 'details');
	if (appearance || details) {
		lines.push('Draft look written by an AI, free to change except where the notes decide:');
		if (appearance) lines.push(`- layout and architecture: ${appearance}`);
		if (details) lines.push(`- details: ${details}`);
	}
	if (others.length) {
		lines.push(
			'Designs the user is keeping (make the new ones different):',
			...others.map((d) => `- ${d.label}: ${d.appearance} ${d.details}`)
		);
	}
	if (guidance) lines.push(`The user's guidance: ${guidance}`);
	lines.push(
		count === CANDIDATE_COUNT ? `Write ${count} designs.` : `Write ${count} new design(s).`
	);
	return [
		{ role: 'system' as const, content: DESIGNS_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const designsHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { locationId, versionIds, guidance, cascade } = job.payload as {
		locationId: number;
		versionIds: Partial<Record<DesignKey, number>>;
		guidance: string;
		cascade: Stage[];
	};
	const s = loadState(db, locationId);
	if (!s) return; // deleted meanwhile
	if (!s.context) throw new Error('The series has no style.');
	const keys = DESIGN_KEYS.filter((k) => versionIds[k] !== undefined);
	const others = DESIGN_KEYS.filter((k) => versionIds[k] === undefined)
		.map((k) => parseDesign(textOf(s, `design:${k}`)))
		.filter((d): d is Design => d !== null);
	const reply = await ai.text.json(
		designMessages(s, keys.length, others, guidance),
		designsReply,
		signal
	);
	const clean = (list: string[]) => list.map((t) => t.trim()).filter(Boolean);
	db.update(locations)
		.set({ designTraits: { fixed: clean(reply.fixed), free: clean(reply.free) } })
		.where(eq(locations.id, locationId))
		.run();
	const inputs = lookInputs(s);
	keys.forEach((key, i) => {
		const d = reply.designs[i];
		finishVersion(db, versionIds[key]!, {
			text: designText({
				label: d?.label.trim() || 'Current look',
				appearance: positiveOnly(d?.appearance.trim() || textOf(s, 'appearance')),
				details: positiveOnly(d?.details.trim() || textOf(s, 'details'))
			}),
			inputs
		});
	});
	advance(db, locationId, after('designs', cascade));
};

const pictureHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { locationId, versionId, key, cascade } = job.payload as {
		locationId: number;
		versionId: number;
		key: DesignKey;
		cascade: Stage[];
	};
	const s = loadState(db, locationId);
	const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
	if (!s || version?.status !== 'pending') return; // deleted or superseded meanwhile
	if (!s.ready) throw new Error('The series’ style is not ready.');
	const design = parseDesign(textOf(s, `design:${key}`));
	if (!design) throw new Error('The design is missing.');
	const prompt = locationPrompt(
		s.ready,
		{ setting: textOf(s, 'setting'), appearance: design.appearance, details: design.details },
		version.guidance
	);
	const inputs = pictureInputs(s, key);
	const result = await ai.image.generate(
		{ model: s.ready.model, prompt, seed: version.seed ?? 0, ...CANDIDATE_SIZE },
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	finishVersion(db, versionId, { text: prompt, assetHash: hash, thumbHash, inputs });
	advance(db, locationId, after('pictures', cascade));
};

const sheetHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { locationId, versionId, view } = job.payload as {
		locationId: number;
		versionId: number;
		view: SheetView;
	};
	const s = loadState(db, locationId);
	const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
	if (!s || version?.status !== 'pending') return; // deleted or superseded meanwhile
	const reference = s.current.get('reference');
	if (!reference?.assetHash) throw new Error('The reference picture is missing.');
	const colorMode = s.context?.colorMode ?? 'bw';
	const prompt = sheetPrompt(colorMode, view, version.guidance, textOf(s, 'setting'));
	const inputs = sheetInputs(s);
	const result = await ai.image.edit(
		{ prompt, images: [readAsset(reference.assetHash)], seed: version.seed ?? 0 },
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	finishVersion(db, versionId, { text: prompt, assetHash: hash, thumbHash, inputs });
};

export const locationJobHandlers: Record<string, JobHandler> = {
	'location.develop': developHandler,
	'location.designs': designsHandler,
	'location.picture': pictureHandler,
	'location.sheet': sheetHandler
};
