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
	type Series,
	type Version
} from './db/schema';
import { randomSeed } from './ai/image';
import type { JobHandler } from './jobs';
import { putRun } from './runs';
import { askJson } from './prompts/ask';
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
	addVersion,
	currentVersions,
	deleteScope,
	describeScope,
	dropPending,
	ensureItem,
	type Access,
	type ItemView
} from './versions';
import { parseScope, scopeOf, slot, slotKeyOf } from './pipeline/ids';
import type { Status, StepRun } from './pipeline/registry';
import {
	ENTITY_STAGES,
	entityPipeline,
	textOf,
	type EntityStage,
	type EntityState
} from './pipeline/entity';

export type { Status };

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
export const characterScope = scopeOf.character;

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
export const STAGES = ENTITY_STAGES;
export type Stage = EntityStage;

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
	look: { age: string; appearance: string; outfit: string },
	guidance = ''
): string {
	const what = uncapitalize(look.age.trim()) || 'one character';
	const subject = [
		`Wide shot, full-body character design of ${what}, alone, in a relaxed neutral pose, facing the viewer, small in the frame with empty space above and below.`,
		sentence(look.appearance),
		look.outfit.trim() ? sentence(`Wearing ${uncapitalize(look.outfit.trim())}`) : '',
		'The whole body is shown, from the top of the head to the ground, against a plain white background.',
		sentence(positiveOnly(guidance)),
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
// State: the current version of every item, and what each is made from.
// What each item is made from, where it stands and what is due are the
// shared entity pipeline's (see pipeline/entity.ts); `flow` below runs it.

interface CharacterState extends EntityState {
	character: Character;
}

/** The series' style, which every character picture is drawn in, once it is ready. */
export function readyStyle(db: Db, owner: Pick<Series, 'styleId'>): DrawingStyle | undefined {
	const style = owner.styleId ? drawingStyle(db, owner.styleId) : undefined;
	return style?.ready ? style : undefined;
}

function stateOf(db: Db, character: Character, owner: Series): CharacterState {
	const context = owner.styleId ? drawingStyle(db, owner.styleId) : undefined;
	const scope = characterScope(character.id);
	return {
		id: character.id,
		ownerId: owner.ownerId,
		scope,
		name: character.name,
		seed: character.seed,
		character,
		series: owner,
		context,
		ready: context?.ready ? context : undefined,
		current: currentVersions(db, scope)
	};
}

const roleOf = (s: CharacterState) => textOf(s, 'role') || s.character.role;

const profileInputs = (s: CharacterState) => ({ brief: textOf(s, 'brief'), role: roleOf(s) });

const lookInputs = (s: CharacterState) => ({
	brief: textOf(s, 'brief'),
	age: textOf(s, 'age'),
	appearance: textOf(s, 'appearance'),
	outfit: textOf(s, 'outfit')
});

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
	for (const r of rows) out.set(parseScope(r.scope).id, r.version);
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
	return cast.map((c) => {
		const current = currentVersions(db, characterScope(c.id));
		const has = (kind: string, key?: string) => Boolean(current.get(slotKeyOf(kind, key)));
		return {
			...c,
			thumb: refs.get(c.id)?.thumbHash ?? null,
			hasReference: refs.has(c.id),
			/** What is still to do to make the character drawable, in order. */
			todo: [
				{ step: 'Profile', done: has('personality') && has('appearance') },
				{ step: 'Designs', done: DESIGN_KEYS.some((k) => has('design', k)) },
				{ step: 'Design pictures', done: DESIGN_KEYS.some((k) => has('picture', k)) },
				{ step: 'Reference chosen', done: refs.has(c.id) },
				{ step: 'Character sheet', done: SHEET_VIEWS.some((v) => has('sheet', v.key)) }
			]
		};
	});
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
	// One scan of the scope says where every item stands and what is due.
	const snap = flow.describe(db, s, INPUT_LABELS);
	const { views, status } = snap;
	const view = (kind: string, key = '') => views.get(slotKeyOf(kind, key)) ?? emptyView(kind, key);
	const all = [...views.values()];
	const due = Object.fromEntries(
		STAGES.map((st) => [st, flow.dueSlots(s, st, snap).length])
	) as Record<Stage, number>;
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
		status: status(slotKeyOf('sheet', v.key))
	}));
	const designs = DESIGN_KEYS.map((key) => ({
		key,
		design: view('design', key),
		designStatus: status(slotKeyOf('design', key)),
		picture: view('picture', key),
		pictureStatus: status(slotKeyOf('picture', key))
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
			designs: summary(DESIGN_KEYS.map((k) => slotKeyOf('design', k))),
			pictures: summary(DESIGN_KEYS.map((k) => slotKeyOf('picture', k))),
			reference: summary(['reference']),
			sheet: summary(SHEET_VIEWS.map((v) => slotKeyOf('sheet', v.key)))
		},
		developing: profileItems.some((p) => p.item.pending),
		designing: designs.some((d) => d.design.pending),
		busy: all.some((v) => v.pending)
	};
}

export type CharacterDetail = ReturnType<typeof getCharacter>;

// ---------------------------------------------------------------------------
// Commands

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
	chapterId?: number,
	/** False adds the character with nothing generated yet, to be developed later. */
	develop = true
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
	if (develop) updateOutdated(db, ownerId, character.id, ['profile', 'designs']);
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
		{ origin: 'user', text: final, inputs: flow.inputsFor(s, slot(kind)) ?? {} },
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
	if (text === textOf(s, slotKeyOf('design', key))) {
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
	/** The user's amendment to the prompt, kept with the version it makes. */
	guidance?: string;
	/** A picture's seed; by default the current one, or a new one if that is up to date. */
	seed?: number | null;
	/** A picture's image model, chosen with its Regenerate button; else the series'. */
	model?: string;
	/** Stages to carry on with once this one finishes (see `updateOutdated`). */
	cascade?: Stage[];
}

function startProfile(db: Db, s: CharacterState, kinds: ProfileKind[], opts: Start = {}): number {
	return flow.start(
		db,
		s,
		'profile',
		kinds.map((k) => slot(k)),
		opts
	);
}

function startDesigns(db: Db, s: CharacterState, keys: DesignKey[], opts: Start = {}): number {
	if (!keys.length) return 0;
	if (!s.context) throw new CharacterError('Describe the series’ style first.');
	if (!textOf(s, 'appearance')) throw new CharacterError('Describe how the character looks first.');
	return flow.start(
		db,
		s,
		'designs',
		keys.map((k) => slot('design', k)),
		opts
	);
}

const NO_STYLE = 'Draw at least one sample picture of the series’ style before drawing characters.';

/** Draw design pictures (see the pictures stage for how seeds are kept). */
function startPictures(db: Db, s: CharacterState, keys: DesignKey[], opts: Start = {}): number {
	if (!keys.length) return 0;
	if (!s.ready) throw new CharacterError(NO_STYLE);
	if (keys.some((k) => !s.current.get(slotKeyOf('design', k)))) {
		throw new CharacterError('Write the design first.');
	}
	return flow.start(
		db,
		s,
		'pictures',
		keys.map((k) => slot('picture', k)),
		opts
	);
}

function startSheet(db: Db, s: CharacterState, views: SheetView[], opts: Start = {}): number {
	if (!views.length) return 0;
	if (!s.ready) throw new CharacterError(NO_STYLE);
	if (!s.current.get('reference')?.assetHash) {
		throw new CharacterError('Choose a reference picture first.');
	}
	return flow.start(
		db,
		s,
		'sheet',
		views.map((v) => slot('sheet', v)),
		opts
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
	return flow.advance(db, characterId, stages);
}

/** Which items are kept, from one scan of the scope. */
const keptIn = (db: Db, characterId: number) => {
	const views = describeScope(db, characterScope(characterId), () => null, {});
	return (kind: string, key?: string) => Boolean(views.get(slotKeyOf(kind, key))?.locked);
};

/** Ask the AI to rewrite profile fields (all not kept, or the ones given), with the user's guidance. */
export function requestProfile(
	db: Db,
	ownerId: number,
	characterId: number,
	opts: { kinds?: ProfileKind[]; guidance?: string } = {}
): number {
	const s = ownedState(db, ownerId, characterId);
	const kept = keptIn(db, characterId);
	const kinds = opts.kinds ?? PROFILE_KINDS.filter((k) => !kept(k));
	if (!kinds.length) throw new CharacterError('Every field is locked.');
	return startProfile(db, s, kinds, { guidance: opts.guidance });
}

/**
 * Ask the AI for new designs (all not kept, or the ones given), then draw
 * each one's picture, so every design shows what it looks like.
 */
export function requestDesigns(
	db: Db,
	ownerId: number,
	characterId: number,
	opts: { keys?: DesignKey[]; guidance?: string } = {}
): number {
	const s = ownedState(db, ownerId, characterId);
	const kept = keptIn(db, characterId);
	const keys = opts.keys ?? DESIGN_KEYS.filter((k) => !kept('design', k));
	if (!keys.length) throw new CharacterError('Every design is locked.');
	return startDesigns(db, s, keys, { guidance: opts.guidance, cascade: ['pictures'] });
}

/** Draw design pictures: the ones given, or every one not kept that has a design. */
export function requestPictures(
	db: Db,
	ownerId: number,
	characterId: number,
	opts: { keys?: DesignKey[]; guidance?: string; seed?: number | null; model?: string } = {}
): number {
	const s = ownedState(db, ownerId, characterId);
	if (!s.ready) throw new CharacterError(NO_STYLE);
	const kept = keptIn(db, characterId);
	const keys =
		opts.keys ??
		DESIGN_KEYS.filter((k) => s.current.get(slotKeyOf('design', k)) && !kept('picture', k));
	return startPictures(db, s, keys, {
		guidance: opts.guidance,
		seed: opts.seed,
		// One picture asked for by name draws with the model chosen for it.
		model: opts.keys?.length === 1 ? opts.model : undefined
	});
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
	guidance = '',
	seed: number | null = null,
	model?: string
): number {
	const s = ownedState(db, ownerId, characterId);
	if (only) return startSheet(db, s, [only], { guidance, seed, model });
	const kept = keptIn(db, characterId);
	return startSheet(
		db,
		s,
		SHEET_VIEWS.map((v) => v.key).filter((v) => !kept('sheet', v)),
		{ guidance }
	);
}

/** Stop drawing the character sheet: cancel the views not drawn yet. */
export function stopSheet(db: Db, ownerId: number, characterId: number): void {
	const s = ownedState(db, ownerId, characterId);
	dropPending(
		db,
		SHEET_VIEWS.map((v) => item(db, s, 'sheet', v.key).id)
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
	// Views still being drawn are from the old reference: stop them, so
	// the sheet is redrawn from this one when the user asks.
	dropPending(
		db,
		SHEET_VIEWS.map((v) => item(db, s, 'sheet', v.key).id)
	);
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
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

const developRun: StepRun<CharacterState> = async ({
	db,
	ai,
	signal,
	state: s,
	slots,
	guidance
}) => {
	const rewrite = PROFILE_KINDS.filter((k) => slots.some((x) => x.ref.kind === k));
	const {
		value: reply,
		prompt,
		run
	} = await askJson(
		ai,
		'character.develop',
		developMessages(s, castOf(db, s), rewrite, guidance),
		developReply,
		signal
	);
	const runHash = await putRun(db, run);
	return new Map(
		rewrite.map((kind) => {
			const raw = reply[kind].trim();
			const text = kind === 'appearance' || kind === 'outfit' ? positiveOnly(raw) : raw;
			return [
				kind,
				text ? { text, notes: reply.notes.trim(), model: ai.text.name, ...prompt, runHash } : null
			];
		})
	);
};

/**
 * The first name a character gets is canonical: the plot and dialogue use
 * it, so the AI doesn't rename them later unless the user unlocks it.
 */
function afterDevelop(db: Db, s: CharacterState, rewritten: { kind: string }[]): void {
	if (rewritten.some((r) => r.kind === 'name')) {
		const name = item(db, s, 'name');
		if (name.currentVersionId !== null && !name.locked) {
			db.update(items).set({ locked: true }).where(eq(items.id, name.id)).run();
		}
	}
	syncCharacter(db, s.character.id);
}

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
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

/**
 * Write the requested designs, and record which traits they vary. A short
 * reply leaves the rest on the current look.
 */
const designsRun: StepRun<CharacterState> = async ({
	db,
	ai,
	signal,
	state: s,
	slots,
	guidance
}) => {
	if (!s.context) throw new Error('The series has no style.');
	const keys = DESIGN_KEYS.filter((k) => slots.some((x) => x.ref.key === k));
	const others = DESIGN_KEYS.filter((k) => !keys.includes(k))
		.map((k) => parseDesign(textOf(s, slotKeyOf('design', k))))
		.filter((d): d is Design => d !== null);
	const {
		value: reply,
		prompt,
		run
	} = await askJson(
		ai,
		'character.designs',
		designMessages(s, keys.length, others, guidance),
		designsReply,
		signal
	);
	const runHash = await putRun(db, run);
	const clean = (list: string[]) => list.map((t) => t.trim()).filter(Boolean);
	db.update(characters)
		.set({ designTraits: { fixed: clean(reply.fixed), free: clean(reply.free) } })
		.where(eq(characters.id, s.character.id))
		.run();
	return new Map(
		keys.map((key, i) => {
			const d = reply.designs[i];
			const text = designText({
				label: d?.label.trim() || 'Current look',
				appearance: positiveOnly(d?.appearance.trim() || textOf(s, 'appearance')),
				outfit: positiveOnly(d?.outfit.trim() || textOf(s, 'outfit'))
			});
			return [slotKeyOf('design', key), { text, model: ai.text.name, ...prompt, runHash }];
		})
	);
};

// ---------------------------------------------------------------------------
// The pipeline

const flow = entityPipeline<CharacterState>({
	domain: 'character',
	load: loadState,
	error: (message) => new CharacterError(message),
	labels: INPUT_LABELS,
	profileKinds: PROFILE_KINDS,
	lookKinds: LOOK_KINDS,
	profileInputs,
	designKeys: DESIGN_KEYS,
	sheetViews: SHEET_VIEWS.map((v) => v.key),
	pictureSize: CANDIDATE_SIZE,
	develop: developRun,
	designs: designsRun,
	afterDevelop,
	picturePrompt: (s, key, guidance) => {
		const design = parseDesign(textOf(s, slotKeyOf('design', key)));
		if (!design) throw new Error('The design is missing.');
		return characterPrompt(
			s.ready,
			{ age: textOf(s, 'age'), appearance: design.appearance, outfit: design.outfit },
			guidance
		);
	},
	sheetPrompt: (colorMode: ColorMode, view, guidance, what) =>
		sheetPrompt(colorMode, view as SheetView, guidance, what)
});

/** Job kinds: character.develop, character.designs, character.picture, character.sheet. */
export const characterJobHandlers: Record<string, JobHandler> = flow.handlers();
