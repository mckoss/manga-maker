import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import {
	chapterCast,
	chapters,
	characters,
	items,
	series,
	versions,
	type Character,
	type ColorMode,
	type Item,
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

export class CharacterError extends Error {}

export const ROLES = {
	protagonist: 'Protagonist',
	antagonist: 'Antagonist',
	supporting: 'Supporting',
	minor: 'Minor'
} as const;

export type Role = keyof typeof ROLES;

export function isRole(value: string): value is Role {
	return value in ROLES;
}

/**
 * Everything about a character is a versioned item in its scope: each text
 * field and each picture keeps every version, records what it was made
 * from, and is marked out of date when that changes. The pipeline:
 *
 *   your notes, role → profile → designs → design pictures → reference → sheet
 *
 * The reference is the user's choice of a design picture; the rest the AI
 * writes or draws, unless the user keeps an item or writes it themselves.
 */
export const characterScope = (characterId: number) => `character:${characterId}`;

/** What the AI writes into the profile from the user's notes and the role. */
export const PROFILE_KINDS = [
	'name',
	'personality',
	'motivation',
	'backstory',
	'speech',
	'age',
	'appearance',
	'outfit'
] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const PROFILE_LABELS: Record<ProfileKind, string> = {
	name: 'Name',
	personality: 'Personality',
	motivation: 'Wants and needs',
	backstory: 'Backstory',
	speech: 'How they talk',
	age: 'Age',
	appearance: 'Appearance',
	outfit: 'Outfit and props'
};

/** The profile fields the image model draws from. */
const LOOK_KINDS = ['age', 'appearance', 'outfit'] as const;

export function isProfileKind(value: string): value is ProfileKind {
	return (PROFILE_KINDS as readonly string[]).includes(value);
}

/** Text the user may save: their own inputs, and any profile field. */
export type TextKind = 'brief' | 'role' | ProfileKind;

export function isTextKind(value: string): value is TextKind {
	return value === 'brief' || value === 'role' || isProfileKind(value);
}

/** The design slots: each holds a design (text) and its picture. */
export const DESIGN_KEYS = ['1', '2', '3', '4'] as const;
export type DesignKey = (typeof DESIGN_KEYS)[number];
export const CANDIDATE_COUNT = DESIGN_KEYS.length;

export function isDesignKey(value: string): value is DesignKey {
	return (DESIGN_KEYS as readonly string[]).includes(value);
}

/** Tall portrait (about 9:16, one megapixel): a full figure, hat to feet, fits. */
export const CANDIDATE_SIZE = { width: 768, height: 1344 };

/** One design: a short label and the look the image model draws. */
export interface Design {
	label: string;
	appearance: string;
	outfit: string;
}

const designSchema = z.object({
	label: z.string().default(''),
	appearance: z.string().default(''),
	outfit: z.string().default('')
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
	JSON.stringify({ label: d.label, appearance: d.appearance, outfit: d.outfit });

/** The stages of the pipeline the AI regenerates. */
export const STAGES = ['profile', 'designs', 'pictures', 'sheet'] as const;
export type Stage = (typeof STAGES)[number];

/** Names of inputs, to say why something is out of date. */
const INPUT_LABELS: Record<string, string> = {
	brief: 'your notes',
	role: 'the role',
	age: 'the age',
	appearance: 'the appearance',
	outfit: 'the outfit',
	design: 'the design',
	style: 'the style prompt',
	color: 'the color mode',
	model: 'the image model',
	reference: 'the reference picture'
};

const uncapitalize = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The full image prompt for a full-body design picture of a character. It
 * opens with what the character is (the age phrase: "a young woman", "a
 * small old dog"), so a dog is drawn as a dog. The framing is stated before
 * and after the description, as a wide shot: a detailed face description
 * otherwise makes Qwen-Image frame a medium shot and crop at the thighs.
 */
export function characterPrompt(
	style: Pick<DrawingStyle, 'colorMode' | 'prompt'>,
	look: { age: string; appearance: string; outfit: string }
): string {
	const what = uncapitalize(look.age.trim()) || 'one character';
	const subject = [
		`Wide shot, full-body character design of ${what}, alone, in a relaxed neutral pose, facing the viewer, small in the frame with empty space above and below.`,
		sentence(look.appearance),
		look.outfit.trim() ? sentence(`Wearing ${uncapitalize(look.outfit.trim())}`) : '',
		'The whole body is shown, from the top of the head to the ground, against a plain white background.',
		TONE_REMINDER[style.colorMode]
	]
		.filter(Boolean)
		.join(' ');
	return compilePrompt(style, subject);
}

const KEEP =
	'Keep the same character exactly: the same kind of being, body, face, hair or fur and markings, and only the clothing and props they already have, adding nothing. Keep the same drawing style, line work and shading.';
const BODY = 'Full body, plain white background.';
const FACE = 'Close-up of the head and shoulders, plain white background.';

/**
 * The character sheet: views and expressions redrawn from the reference
 * picture with the edit model, so later panels can draw the character from
 * any angle and in any mood.
 */
export const SHEET_VIEWS = [
	{
		key: 'three-quarter',
		label: 'Three-quarter',
		instruction: `Show this character turned three-quarters to the left. ${BODY}`
	},
	{
		key: 'side',
		label: 'Side',
		instruction: `Show this character from the side, in profile, facing left. ${BODY}`
	},
	{ key: 'back', label: 'Back', instruction: `Show this character from behind. ${BODY}` },
	{ key: 'neutral', label: 'Neutral', instruction: `${FACE} Calm, neutral expression.` },
	{ key: 'happy', label: 'Happy', instruction: `${FACE} Laughing happily.` },
	{ key: 'angry', label: 'Angry', instruction: `${FACE} Furious, shouting.` },
	{ key: 'sad', label: 'Sad', instruction: `${FACE} Sad, on the verge of tears.` },
	{ key: 'surprised', label: 'Surprised', instruction: `${FACE} Shocked and surprised, eyes wide.` }
] as const;

export type SheetView = (typeof SHEET_VIEWS)[number]['key'];

export function isSheetView(value: string): value is SheetView {
	return SHEET_VIEWS.some((v) => v.key === value);
}

/**
 * The edit instruction for one sheet view, in the series' color mode, with
 * the user's guidance for that one redraw ("looking over her shoulder").
 * Naming what the character is ("a small old dog") keeps the edit model
 * from turning it into something else.
 */
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
			what.trim() ? sentence(`The character is ${uncapitalize(what.trim())}`) : '',
			instruction,
			sentence(guidance),
			KEEP,
			TONE_REMINDER[colorMode]
		]
			.filter(Boolean)
			.join(' ')
	);
}

// ---------------------------------------------------------------------------
// State: the current version of every item, and what each is made from

interface CharacterState {
	character: Character;
	series: Series;
	/** The series' style, ready or not: the AI's context for the setting. */
	context: DrawingStyle | undefined;
	/** The series' style once it can draw (it has a prompt and a sample). */
	ready: DrawingStyle | undefined;
	current: Map<string, Version>;
}

/** The series' style, which every character picture is drawn in, once it is ready. */
export function readyStyle(db: Db, owner: Pick<Series, 'styleId'>): DrawingStyle | undefined {
	const style = owner.styleId ? drawingStyle(db, owner.styleId) : undefined;
	return style?.ready ? style : undefined;
}

function stateOf(db: Db, character: Character, owner: Series): CharacterState {
	const context = owner.styleId ? drawingStyle(db, owner.styleId) : undefined;
	return {
		character,
		series: owner,
		context,
		ready: context?.ready ? context : undefined,
		current: currentVersions(db, characterScope(character.id))
	};
}

const textOf = (s: CharacterState, slot: string) => s.current.get(slot)?.text ?? '';
const roleOf = (s: CharacterState) => textOf(s, 'role') || s.character.role;

const profileInputs = (s: CharacterState) => ({ brief: textOf(s, 'brief'), role: roleOf(s) });

const lookInputs = (s: CharacterState) => ({
	brief: textOf(s, 'brief'),
	age: textOf(s, 'age'),
	appearance: textOf(s, 'appearance'),
	outfit: textOf(s, 'outfit')
});

const styleInputs = (s: CharacterState) => ({
	style: String(s.ready?.promptVersionId ?? ''),
	color: s.ready?.colorMode ?? '',
	model: s.ready?.model ?? ''
});

const pictureInputs = (s: CharacterState, key: string) => ({
	design: textOf(s, `design:${key}`),
	age: textOf(s, 'age'),
	...styleInputs(s)
});

const referenceInputs = (s: CharacterState) => ({ ...lookInputs(s), ...styleInputs(s) });

const sheetInputs = (s: CharacterState) => ({
	reference: String(s.current.get('reference')?.id ?? ''),
	color: s.context?.colorMode ?? ''
});

/** What a new version of an item would be made from; null for the user's own inputs. */
function inputsFor(s: CharacterState, item: Pick<Item, 'kind' | 'key'>) {
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
	if (item.kind === 'picture') return [`design:${item.key}`, 'age'];
	if (item.kind === 'reference') return [...LOOK_KINDS];
	if (item.kind === 'sheet') return ['reference'];
	return [];
}

/**
 * Where an item stands:
 * - missing: never made;
 * - pending: being made;
 * - outdated: made from inputs that have changed since;
 * - upstream: up to date with its inputs, but an earlier step it is made
 *   from is out of date (and not kept), so it will change once that does;
 * - ok.
 */
export type Status = 'missing' | 'pending' | 'outdated' | 'upstream' | 'ok';

function statuses(views: Map<string, ItemView>) {
	const memo = new Map<string, Status>();
	const view = (slot: string) => views.get(slot);
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
			const changing = upstreamOf({ kind, key }).some((u) => {
				if (view(u)?.locked) return false;
				return status(u) !== 'ok';
			});
			result = changing ? 'upstream' : 'ok';
		}
		memo.set(slot, result);
		return result;
	};
	/** Every earlier step is settled: kept, or up to date. */
	const settled = (slot: string) => {
		const [kind, key = ''] = slot.split(':');
		return upstreamOf({ kind, key }).every((u) => view(u)?.locked || status(u) === 'ok');
	};
	return { status, settled };
}

/** Slots that can be regenerated now: not kept, missing or out of date, with earlier steps settled. */
function dueSlots(db: Db, s: CharacterState, stage: Stage): string[] {
	const views = describeScope(db, characterScope(s.character.id), (i) => inputsFor(s, i), {});
	const { status, settled } = statuses(views);
	const due = (slot: string) => {
		if (views.get(slot)?.locked) return false;
		const st = status(slot);
		return (st === 'missing' || st === 'outdated') && settled(slot);
	};
	if (stage === 'profile') {
		if (!textOf(s, 'brief') && !s.character.name) return [];
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

function ownedCharacter(db: Db, ownerId: number, characterId: number) {
	const row = db
		.select({ character: characters, series })
		.from(characters)
		.innerJoin(series, eq(characters.seriesId, series.id))
		.where(eq(characters.id, characterId))
		.get();
	if (!row || row.series.ownerId !== ownerId) throw new CharacterError('Character not found.');
	return row;
}

function loadState(db: Db, characterId: number): CharacterState | undefined {
	const row = db
		.select({ character: characters, series })
		.from(characters)
		.innerJoin(series, eq(characters.seriesId, series.id))
		.where(eq(characters.id, characterId))
		.get();
	return row ? stateOf(db, row.character, row.series) : undefined;
}

function ownedState(db: Db, ownerId: number, characterId: number): CharacterState {
	const { character, series: owner } = ownedCharacter(db, ownerId, characterId);
	return stateOf(db, character, owner);
}

/** Who may change a character's items. */
export function characterAccess(db: Db, ownerId: number, characterId: number): Access {
	ownedCharacter(db, ownerId, characterId);
	return { ownerId, scope: characterScope(characterId) };
}

/** The current reference version of each character. */
export function references(db: Db, characterIds: number[]): Map<number, Version> {
	const out = new Map<number, Version>();
	if (!characterIds.length) return out;
	const rows = db
		.select({ scope: items.scope, version: versions })
		.from(items)
		.innerJoin(versions, eq(versions.id, items.currentVersionId))
		.where(
			and(
				eq(items.kind, 'reference'),
				inArray(
					items.scope,
					characterIds.map((id) => characterScope(id))
				)
			)
		)
		.all();
	for (const r of rows) out.set(Number(r.scope.split(':')[1]), r.version);
	return out;
}

export function listCharacters(db: Db, ownerId: number, seriesId: number) {
	ownedSeries(db, ownerId, seriesId);
	const cast = db
		.select()
		.from(characters)
		.where(eq(characters.seriesId, seriesId))
		.orderBy(characters.id)
		.all();
	const refs = references(
		db,
		cast.map((c) => c.id)
	);
	return cast.map((c) => ({
		...c,
		thumb: refs.get(c.id)?.thumbHash ?? null,
		hasReference: refs.has(c.id)
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

export function getCharacter(db: Db, ownerId: number, characterId: number) {
	const s = ownedState(db, ownerId, characterId);
	const views = describeScope(
		db,
		characterScope(characterId),
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
			/** Not kept, and out of date now or once an earlier step is redone. */
			stale: of(['outdated', 'upstream']).filter((slot) => !views.get(slot)?.locked).length,
			kept: slots.filter((slot) => views.get(slot)?.locked).length
		};
	};
	return {
		character: s.character,
		series: s.series,
		style: s.ready ?? null,
		hasStyle: Boolean(s.context),
		brief: view('brief'),
		role: roleOf(s),
		roleItem: view('role'),
		notes,
		profile: profileItems,
		designs,
		traits: s.character.designTraits,
		reference: { item: view('reference'), status: status('reference') },
		sheet,
		/** Items that can be regenerated now, by stage. */
		due,
		/** The pipeline, step by step, for the diagram. */
		flow: {
			notes: summary(['brief', 'role']),
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

export type CharacterDetail = ReturnType<typeof getCharacter>;

// ---------------------------------------------------------------------------
// Commands

/** Turn a VersionError into a CharacterError the page shows. */
function run<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof VersionError) throw new CharacterError(e.message);
		throw e;
	}
}

const item = (db: Db, s: CharacterState, kind: string, key = '') =>
	ensureItem(db, s.series.ownerId, characterScope(s.character.id), kind, key);

/** Copy the current name and role to the character row, for lists. */
export function syncCharacter(db: Db, characterId: number): void {
	const current = currentVersions(db, characterScope(characterId));
	const role = current.get('role')?.text;
	db.update(characters)
		.set({
			name: current.get('name')?.text ?? '',
			...(role && isRole(role) ? { role } : {}),
			updatedAt: new Date()
		})
		.where(eq(characters.id, characterId))
		.run();
}

export interface NewCharacter {
	name: string;
	role: Role;
	brief: string;
}

/**
 * Add a character to a series and ask the AI to develop a profile from the
 * notes, then write designs from it. Made while working on a chapter, it
 * joins that chapter's cast too. A name the user gives is kept.
 */
export function createCharacter(
	db: Db,
	ownerId: number,
	seriesId: number,
	input: NewCharacter,
	chapterId?: number
): number {
	const owner = ownedSeries(db, ownerId, seriesId);
	if (chapterId !== undefined) {
		const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
		if (chapter?.seriesId !== seriesId) throw new CharacterError('Chapter not found.');
	}
	const name = input.name.trim();
	const brief = input.brief.trim();
	if (!name && !brief) throw new CharacterError('Give the character a name or a description.');
	const now = new Date();
	const character = db
		.insert(characters)
		.values({
			seriesId,
			name,
			role: input.role,
			seed: randomSeed(),
			createdAt: now,
			updatedAt: now
		})
		.returning()
		.get();
	const scope = characterScope(character.id);
	addVersion(db, ensureItem(db, ownerId, scope, 'role'), { origin: 'user', text: input.role });
	if (brief)
		addVersion(db, ensureItem(db, ownerId, scope, 'brief'), { origin: 'user', text: brief });
	if (name) {
		const s = stateOf(db, character, owner);
		addVersion(
			db,
			ensureItem(db, ownerId, scope, 'name'),
			{ origin: 'user', text: name, inputs: profileInputs(s) },
			{ keep: true }
		);
	}
	if (chapterId !== undefined) {
		db.insert(chapterCast).values({ chapterId, characterId: character.id, createdAt: now }).run();
	}
	touchSeries(db, seriesId);
	updateOutdated(db, ownerId, character.id, ['profile', 'designs']);
	return character.id;
}

/**
 * Save the user's own wording of a text field as a new version, if it
 * changed. A profile field the user writes is kept from then on unless
 * `keep` is false, so the AI doesn't rewrite it. Nothing downstream is
 * regenerated: it is marked out of date until the user updates it.
 */
export function saveText(
	db: Db,
	ownerId: number,
	characterId: number,
	kind: TextKind,
	text: string,
	keep = true
): void {
	const s = ownedState(db, ownerId, characterId);
	const value = text.trim();
	if (kind === 'role' && !isRole(value)) throw new CharacterError('Choose a role.');
	if (kind === 'name' && !value) throw new CharacterError('Give the character a name.');
	const it = item(db, s, kind);
	const generated = isProfileKind(kind);
	const visual = kind === 'appearance' || kind === 'outfit';
	const final = visual ? positiveOnly(value) : value;
	if (final === textOf(s, kind)) {
		// Unchanged: only the keep box may have changed.
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
	if (kind === 'name' || kind === 'role') syncCharacter(db, characterId);
	touchSeries(db, s.series.id);
}

/** Save the user's version of one design, kept unless `keep` is false. */
export function saveDesign(
	db: Db,
	ownerId: number,
	characterId: number,
	key: string,
	design: Design,
	keep = true
): void {
	if (!isDesignKey(key)) throw new CharacterError('Unknown design.');
	const s = ownedState(db, ownerId, characterId);
	const clean = {
		label: design.label.trim(),
		appearance: positiveOnly(design.appearance.trim()),
		outfit: positiveOnly(design.outfit.trim())
	};
	if (!clean.appearance) throw new CharacterError('Describe how this design looks.');
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
	/** Stages to carry on with once this one finishes (see `updateOutdated`). */
	cascade?: Stage[];
}

function startProfile(db: Db, s: CharacterState, kinds: ProfileKind[], opts: Start = {}): number {
	if (!kinds.length) return 0;
	const started = run(() =>
		kinds.map((k) => [k, startVersion(db, item(db, s, k), { guidance: opts.guidance }).id] as const)
	);
	const job = enqueue(db, s.series.ownerId, 'character.develop', {
		characterId: s.character.id,
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

function startDesigns(db: Db, s: CharacterState, keys: DesignKey[], opts: Start = {}): number {
	if (!keys.length) return 0;
	if (!s.context) throw new CharacterError('Describe the series’ style first.');
	if (!textOf(s, 'appearance')) throw new CharacterError('Describe how the character looks first.');
	const started = run(() =>
		keys.map(
			(k) =>
				[k, startVersion(db, item(db, s, 'design', k), { guidance: opts.guidance }).id] as const
		)
	);
	const job = enqueue(db, s.series.ownerId, 'character.designs', {
		characterId: s.character.id,
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

const NO_STYLE = 'Draw at least one sample picture of the series’ style before drawing characters.';

/**
 * Draw design pictures. Each keeps the seed of its current version when its
 * design or the style changed, so the new picture shows what the change
 * did; redrawing an up-to-date picture uses a new seed.
 */
function startPictures(db: Db, s: CharacterState, keys: DesignKey[], opts: Start = {}): number {
	if (!keys.length) return 0;
	if (!s.ready) throw new CharacterError(NO_STYLE);
	const views = describeScope(db, characterScope(s.character.id), (i) => inputsFor(s, i), {});
	return run(
		() =>
			keys.map((key) => {
				if (!s.current.get(`design:${key}`)) throw new CharacterError('Write the design first.');
				const current = s.current.get(`picture:${key}`);
				const view = views.get(`picture:${key}`);
				const outOfDate = view?.versions.find((v) => v.id === view.currentId)?.outOfDate.length;
				const seed =
					current && !outOfDate
						? randomSeed()
						: (current?.seed ?? s.character.seed + DESIGN_KEYS.indexOf(key));
				const version = startVersion(db, item(db, s, 'picture', key), { seed });
				const job = enqueue(db, s.series.ownerId, 'character.picture', {
					characterId: s.character.id,
					versionId: version.id,
					key,
					cascade: opts.cascade ?? []
				});
				attachJob(db, [version.id], job.id);
				return version;
			}).length
	);
}

function startSheet(db: Db, s: CharacterState, views: SheetView[], opts: Start = {}): number {
	if (!views.length) return 0;
	if (!s.ready) throw new CharacterError(NO_STYLE);
	if (!s.current.get('reference')?.assetHash) {
		throw new CharacterError('Choose a reference picture first.');
	}
	const seed = randomSeed();
	return run(
		() =>
			views.map((view, i) => {
				const version = startVersion(db, item(db, s, 'sheet', view), {
					seed: seed + i,
					guidance: opts.guidance
				});
				const job = enqueue(db, s.series.ownerId, 'character.sheet', {
					characterId: s.character.id,
					versionId: version.id,
					view
				});
				attachJob(db, [version.id], job.id);
				return version;
			}).length
	);
}

/**
 * Regenerate what is missing or out of date and not kept, in the given
 * stages, as far as the pipeline allows now: a step waits for the earlier
 * steps it is made from. Each job carries the stages on, so once a step is
 * done the next is regenerated from it. Returns how many items it started.
 */
export function updateOutdated(
	db: Db,
	ownerId: number,
	characterId: number,
	stages: readonly Stage[] = STAGES
): number {
	ownedCharacter(db, ownerId, characterId);
	return advance(db, characterId, stages);
}

/** The stages after one, to carry a cascade on without redoing that stage. */
const after = (stage: Stage, cascade: Stage[]) =>
	cascade.filter((st) => STAGES.indexOf(st) > STAGES.indexOf(stage));

function advance(db: Db, characterId: number, stages: readonly Stage[]): number {
	const s = loadState(db, characterId);
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
			// Each view keeps the guidance it was last drawn with.
			for (const view of keys as SheetView[]) {
				started += startSheet(db, s, [view], {
					guidance: s.current.get(`sheet:${view}`)?.guidance ?? ''
				});
			}
		}
	}
	return started;
}

/** Ask the AI to rewrite profile fields (all not kept, or the ones given), with the user's guidance. */
export function requestProfile(
	db: Db,
	ownerId: number,
	characterId: number,
	opts: { kinds?: ProfileKind[]; guidance?: string } = {}
): number {
	const s = ownedState(db, ownerId, characterId);
	const views = describeScope(db, characterScope(characterId), () => null, {});
	const kinds = opts.kinds ?? PROFILE_KINDS.filter((k) => !views.get(k)?.locked);
	if (!kinds.length) throw new CharacterError('Every field is kept.');
	return startProfile(db, s, kinds, { guidance: opts.guidance });
}

/** Ask the AI for new designs (all not kept, or the ones given). They are not drawn yet. */
export function requestDesigns(
	db: Db,
	ownerId: number,
	characterId: number,
	opts: { keys?: DesignKey[]; guidance?: string } = {}
): number {
	const s = ownedState(db, ownerId, characterId);
	const views = describeScope(db, characterScope(characterId), () => null, {});
	const keys = opts.keys ?? DESIGN_KEYS.filter((k) => !views.get(`design:${k}`)?.locked);
	if (!keys.length) throw new CharacterError('Every design is kept.');
	return startDesigns(db, s, keys, { guidance: opts.guidance });
}

/** Draw design pictures: the ones given, or every one not kept that has a design. */
export function requestPictures(
	db: Db,
	ownerId: number,
	characterId: number,
	opts: { keys?: DesignKey[] } = {}
): number {
	const s = ownedState(db, ownerId, characterId);
	if (!s.ready) throw new CharacterError(NO_STYLE);
	const views = describeScope(db, characterScope(characterId), () => null, {});
	const keys =
		opts.keys ??
		DESIGN_KEYS.filter((k) => s.current.get(`design:${k}`) && !views.get(`picture:${k}`)?.locked);
	return startPictures(db, s, keys);
}

/**
 * Redraw sheet views from the reference picture: every view not kept, or
 * just one, with the user's guidance for it. Each round uses new seeds.
 */
export function requestSheet(
	db: Db,
	ownerId: number,
	characterId: number,
	only?: SheetView,
	guidance = ''
): number {
	const s = ownedState(db, ownerId, characterId);
	if (only) return startSheet(db, s, [only], { guidance });
	const views = describeScope(db, characterScope(characterId), () => null, {});
	return startSheet(
		db,
		s,
		SHEET_VIEWS.map((v) => v.key).filter((v) => !views.get(`sheet:${v}`)?.locked)
	);
}

/**
 * Make a design picture (any version of it) the character's reference: a
 * new version of the reference item, which records the design and the
 * profile it was made from, so it is out of date when they change.
 * Chapters the character joined before it had a reference take this one.
 */
export function chooseReference(
	db: Db,
	ownerId: number,
	characterId: number,
	pictureVersionId: number
): void {
	const s = ownedState(db, ownerId, characterId);
	const row = db
		.select({ version: versions, item: items })
		.from(versions)
		.innerJoin(items, eq(items.id, versions.itemId))
		.where(eq(versions.id, pictureVersionId))
		.get();
	if (
		!row ||
		row.item.scope !== characterScope(characterId) ||
		row.item.kind !== 'picture' ||
		row.version.status !== 'ready' ||
		!row.version.assetHash
	) {
		throw new CharacterError('That picture is not ready.');
	}
	const picture = row.version;
	if (s.current.get('reference')?.assetHash === picture.assetHash) return;
	const design = picture.inputs.design ?? '';
	// The profile the design was written from.
	const designItem = item(db, s, 'design', row.item.key);
	const designVersion = db
		.select()
		.from(versions)
		.where(and(eq(versions.itemId, designItem.id), eq(versions.text, design)))
		.all()
		.at(-1);
	const reference = addVersion(db, item(db, s, 'reference'), {
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
	db.update(chapterCast)
		.set({ pinnedVersionId: reference.id })
		.where(and(eq(chapterCast.characterId, characterId), isNull(chapterCast.pinnedVersionId)))
		.run();
	touchSeries(db, s.series.id);
}

export function deleteCharacter(db: Db, ownerId: number, characterId: number): void {
	const { character } = ownedCharacter(db, ownerId, characterId);
	deleteScope(db, characterScope(characterId));
	db.delete(characters).where(eq(characters.id, characterId)).run();
	touchSeries(db, character.seriesId);
}

// ---------------------------------------------------------------------------
// Jobs

const DEVELOP_SYSTEM = `You are an experienced manga story editor and character designer, helping someone who may be new to comics build the cast of a short manga (under 30 pages).

Develop the character from the user's notes into a profile. Keep everything the user has decided; fill gaps with choices that suit the story, its setting and era, and the character's role. Make the character distinct from the rest of the cast in personality and, above all, in silhouette and look, so readers can tell them apart at a glance in black and white.

Reply with only a JSON object with these keys (all strings):
- "name": the character's name.
- "personality": two or three sentences, including one real flaw.
- "motivation": what they want, and what they need but don't see; one or two sentences.
- "backstory": two or three sentences of history that matters to the story.
- "speech": how they talk, in one sentence (vocabulary, rhythm, verbal habits).
- "age": a short phrase, for example "a woman in her early twenties".
- "appearance": 25 to 60 words an image model can draw: build and height, face, eyes, hair (style and color), skin, distinguishing marks. Physical and visible only; no personality.
- "outfit": 15 to 40 words: their usual clothes and any signature props, right for the setting and era.
- "notes": two or three plain-language sentences to the user about the choices you made and what they might decide next.

Fields marked as kept are fixed: repeat them exactly, and make the rest fit them.

The character may be an animal, a creature or a robot rather than a person. "age" always says what they are along with their age ("a woman in her early twenties", "a young adult dog"), and "appearance" starts with what they are ("a small shaggy dog with…"). For an animal, describe its body as that animal, and "outfit" lists only what it really wears or carries (a rope collar), or is empty; never dress an animal in clothes unless the notes say so.

The image model reads negation as a request ("no hat" draws a hat), so never write "no", "not" or "without" in "appearance" or "outfit": describe only what is there.

When the manga is not in full color, describe hair, eyes, skin and clothing in tones (black, white, dark, pale, light gray) and patterns, never in hues: a word like "indigo" or "red" makes the image model paint in color.`;

const developReply = z.object({
	name: z.string().default(''),
	personality: z.string().default(''),
	motivation: z.string().default(''),
	backstory: z.string().default(''),
	speech: z.string().default(''),
	age: z.string().default(''),
	appearance: z.string().default(''),
	outfit: z.string().default(''),
	notes: z.string().default('')
});

/** The other characters in the series, as the AI sees them. */
function castOf(db: Db, s: CharacterState) {
	const others = db
		.select()
		.from(characters)
		.where(eq(characters.seriesId, s.series.id))
		.all()
		.filter((c) => c.id !== s.character.id && c.name);
	return others.map((c) => {
		const current = currentVersions(db, characterScope(c.id));
		return {
			name: c.name,
			role: c.role,
			look: current.get('appearance')?.text || current.get('brief')?.text || ''
		};
	});
}

export function developMessages(
	s: CharacterState,
	cast: { name: string; role: string; look: string }[],
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
	if (cast.length) {
		lines.push('The rest of the cast:', ...cast.map((c) => `- ${c.name} (${c.role}): ${c.look}`));
	}
	const role = roleOf(s);
	lines.push(`This character's role: ${ROLES[role as Role] ?? role}`);
	const brief = textOf(s, 'brief');
	if (brief) lines.push(`The user's notes on this character: ${brief}`);
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
	const { characterId, versionIds, guidance, cascade } = job.payload as {
		characterId: number;
		versionIds: Partial<Record<ProfileKind, number>>;
		guidance: string;
		cascade: Stage[];
	};
	const s = loadState(db, characterId);
	if (!s) return; // deleted meanwhile
	const rewrite = PROFILE_KINDS.filter((k) => versionIds[k] !== undefined);
	const reply = await ai.text.json(
		developMessages(s, castOf(db, s), rewrite, guidance),
		developReply,
		signal
	);
	const inputs = profileInputs(s);
	for (const kind of rewrite) {
		const id = versionIds[kind]!;
		const raw = reply[kind].trim();
		const text = kind === 'appearance' || kind === 'outfit' ? positiveOnly(raw) : raw;
		if (text) finishVersion(db, id, { text, inputs, notes: reply.notes.trim() });
		else abandonVersion(db, id);
	}
	syncCharacter(db, characterId);
	advance(db, characterId, after('profile', cascade));
};

const DESIGNS_SYSTEM = `You are an experienced manga character designer. You propose clearly different visual designs for one character, so the user can pick the look they like best.

Work in two steps.

First, sort the character's visible traits into fixed and free. A trait is fixed only when the user's own notes, the character's age, or the setting and era decide it. Everything else is free: traits the notes leave vague ("tough-looking", "a kid") and traits they never mention. The draft appearance and outfit were written by an AI, not the user: a trait that appears only in the draft (a scar, a hairstyle, freckles, a build) is free, and the designs should not all repeat it. Consider at least: build and height, posture, face shape, eyes, hair length and style, hair tone, skin tone, distinguishing marks, outfit cut and layering, outfit tones and patterns, footwear, and a signature prop or accessory.

Second, write the designs asked for, spread across the free traits. For each free trait, give the designs clearly different values from across its full range (slight to stocky, cropped to waist-length, plain to ornate), not small variations of one choice. When asked for the full set, the first design stays close to the current draft; each of the others combines different values, so no two designs share a silhouette at a glance. New designs also differ from the designs the user is keeping. Every design keeps every fixed trait.

What the character is (a person, a dog, a robot) is always fixed: each design's "appearance" starts with it ("a lanky teenage boy…", "a small shaggy dog…"). For an animal, vary the animal's own traits (build, coat, ears, tail, markings), and its "outfit" is only what it really wears or carries, often just a collar, or empty; never put an animal in clothes unless the notes say so. Outfit cut, layering and footwear apply to characters who wear clothes.

Reply with only a JSON object with these keys:
- "fixed": an array of short phrases, the traits that are fixed and what decides each.
- "free": an array of the free traits, each with the range of values the designs use, for example "hair: cropped / shoulder-length / long braid / shaved sides".
- "designs": an array of objects, each with these keys (all strings):
  - "label": three to six words that set the design apart, for example "lanky, long braid, travel cloak".
  - "appearance": 25 to 60 words an image model can draw: build and height, face, eyes, hair, skin, distinguishing marks. Physical and visible only.
  - "outfit": 15 to 40 words: clothes and signature props, right for the setting and era.

The image model reads negation as a request ("no hat" draws a hat), so never write "no", "not" or "without" in a design: describe only what is there.

When the series is not in full color, describe hair, eyes, skin and clothing in tones (black, white, dark, pale, light gray) and patterns, never in hues.`;

const designsReply = z.object({
	fixed: z.array(z.string()).default([]),
	free: z.array(z.string()).default([]),
	designs: z.array(designSchema).default([])
});

export function designMessages(s: CharacterState, count: number, others: Design[], guidance = '') {
	const style = s.context!;
	const role = roleOf(s);
	const lines = [
		`Series title: ${s.series.title}`,
		`Setting and look of the series: ${style.description}`,
		`Color: ${COLOR_MODES[style.colorMode].label}`,
		`Character: ${textOf(s, 'name') || s.character.name || 'unnamed'}, ${ROLES[role as Role] ?? role}`
	];
	const age = textOf(s, 'age');
	if (age) lines.push(`Age: ${age}`);
	lines.push(
		`The user's own notes on this character (the only fixed traits besides age, setting and era): ${textOf(s, 'brief') || '(none)'}`
	);
	const personality = textOf(s, 'personality');
	if (personality) lines.push(`Personality: ${personality}`);
	const appearance = textOf(s, 'appearance');
	const outfit = textOf(s, 'outfit');
	if (appearance || outfit) {
		lines.push('Draft look written by an AI, free to change except where the notes decide:');
		if (appearance) lines.push(`- appearance: ${appearance}`);
		if (outfit) lines.push(`- outfit: ${outfit}`);
	}
	if (others.length) {
		lines.push(
			'Designs the user is keeping (make the new ones different):',
			...others.map((d) => `- ${d.label}: ${d.appearance} Wearing ${d.outfit}`)
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

/**
 * Write the requested designs, and record which traits they vary. A short
 * reply leaves the rest on the current look.
 */
const designsHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { characterId, versionIds, guidance, cascade } = job.payload as {
		characterId: number;
		versionIds: Partial<Record<DesignKey, number>>;
		guidance: string;
		cascade: Stage[];
	};
	const s = loadState(db, characterId);
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
	db.update(characters)
		.set({ designTraits: { fixed: clean(reply.fixed), free: clean(reply.free) } })
		.where(eq(characters.id, characterId))
		.run();
	const inputs = lookInputs(s);
	keys.forEach((key, i) => {
		const d = reply.designs[i];
		finishVersion(db, versionIds[key]!, {
			text: designText({
				label: d?.label.trim() || 'Current look',
				appearance: positiveOnly(d?.appearance.trim() || textOf(s, 'appearance')),
				outfit: positiveOnly(d?.outfit.trim() || textOf(s, 'outfit'))
			}),
			inputs
		});
	});
	advance(db, characterId, after('designs', cascade));
};

const pictureHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { characterId, versionId, key, cascade } = job.payload as {
		characterId: number;
		versionId: number;
		key: DesignKey;
		cascade: Stage[];
	};
	const s = loadState(db, characterId);
	const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
	if (!s || version?.status !== 'pending') return; // deleted or superseded meanwhile
	if (!s.ready) throw new Error('The series’ style is not ready.');
	const design = parseDesign(textOf(s, `design:${key}`));
	if (!design) throw new Error('The design is missing.');
	const prompt = characterPrompt(s.ready, {
		age: textOf(s, 'age'),
		appearance: design.appearance,
		outfit: design.outfit
	});
	const inputs = pictureInputs(s, key);
	const result = await ai.image.generate(
		{ model: s.ready.model, prompt, seed: version.seed ?? 0, ...CANDIDATE_SIZE },
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	finishVersion(db, versionId, { text: prompt, assetHash: hash, thumbHash, inputs });
	advance(db, characterId, after('pictures', cascade));
};

const sheetHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { characterId, versionId, view } = job.payload as {
		characterId: number;
		versionId: number;
		view: SheetView;
	};
	const s = loadState(db, characterId);
	const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
	if (!s || version?.status !== 'pending') return; // deleted or superseded meanwhile
	const reference = s.current.get('reference');
	if (!reference?.assetHash) throw new Error('The reference picture is missing.');
	const colorMode = s.context?.colorMode ?? 'bw';
	const prompt = sheetPrompt(colorMode, view, version.guidance, textOf(s, 'age'));
	const inputs = sheetInputs(s);
	const result = await ai.image.edit(
		{ prompt, images: [readAsset(reference.assetHash)], seed: version.seed ?? 0 },
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	finishVersion(db, versionId, { text: prompt, assetHash: hash, thumbHash, inputs });
};

export const characterJobHandlers: Record<string, JobHandler> = {
	'character.develop': developHandler,
	'character.designs': designsHandler,
	'character.picture': pictureHandler,
	'character.sheet': sheetHandler
};
