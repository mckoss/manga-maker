/**
 * A chapter's script: pages → panels → words. Shared by the server and the
 * pages. See "3b. Script" in PLAN.md: the AI may draft staging (pages,
 * panels, shots, who and where) into empty fields only, and never writes
 * words (speech, thought, captions, sfx); those are the user's.
 *
 * Stored as versioned items in the scope `script:<chapterId>`:
 * - `layout`: `Layout`, the pages in reading order;
 * - `panel:<pid>`: `Panel`, one panel's staging;
 * - `words:<pid>`: `TextBlock[]`, one panel's words (only ever the user's).
 */

/** Ids of pages, panels and text blocks: short, slot-safe ("p3k9x2"). */
export const ID_PATTERN = /^[a-z0-9]{4,16}$/;

export function newId(): string {
	let id = '';
	while (id.length < 8) id += Math.random().toString(36).slice(2);
	return id.slice(0, 8);
}

export const isId = (v: unknown): v is string => typeof v === 'string' && ID_PATTERN.test(v);

export const SHOTS = [
	{ key: 'establishing', label: 'Establishing', hint: 'Where we are: the whole place.' },
	{ key: 'wide', label: 'Wide', hint: 'Figures small in their surroundings.' },
	{ key: 'full', label: 'Full', hint: 'Whole figures, head to toe.' },
	{ key: 'medium', label: 'Medium', hint: 'Waist up: talk and gesture.' },
	{ key: 'close', label: 'Close-up', hint: 'A face: what they feel.' },
	{
		key: 'extreme',
		label: 'Extreme close-up',
		hint: 'Eyes, a hand, an object: a detail that matters.'
	},
	{ key: 'over-shoulder', label: 'Over the shoulder', hint: 'One speaker seen past another.' },
	{ key: 'pov', label: 'Point of view', hint: 'What a character sees.' },
	{ key: 'insert', label: 'Insert', hint: 'A prop or sign, alone in the frame.' }
] as const;

export type ShotKey = (typeof SHOTS)[number]['key'];

export const isShot = (v: unknown): v is ShotKey => SHOTS.some((s) => s.key === v);

/** One page: which beat it belongs to, what it is for, and its panels in reading order. */
export interface ScriptPage {
	id: string;
	/** The plot beat's key ("hook"). */
	beat: string;
	/** What this page is for, in a sentence (the user's, or the AI's draft). */
	purpose: string;
	/** A reveal lands as the reader turns to this page. */
	turn: boolean;
	/** The panel the page is about, or null. */
	keyPanel: string | null;
	panels: string[];
	/**
	 * The digest of the beat's text when the page was laid out or last
	 * checked against it; the page shows "Beat changed" when it differs.
	 */
	seen: string;
}

export interface Layout {
	pages: ScriptPage[];
}

/** The staging fields of a panel the AI may draft (into blanks only). */
export const STAGING_FIELDS = ['shot', 'location', 'characters', 'action', 'cue'] as const;
export type StagingField = (typeof STAGING_FIELDS)[number];

/** One panel's staging: what it shows. Never its words. */
export interface Panel {
	shot: ShotKey | '';
	/** A series location id, or null. */
	location: number | null;
	/** Series character ids, in the frame. */
	characters: number[];
	/** What the panel shows, in the writer's words. */
	action: string;
	/**
	 * A question to start the writer on this panel's words ("What does Mira
	 * say when she sees the letter?"). Never the words themselves.
	 */
	cue: string;
	/** Fields the AI drafted and the user has not touched since. */
	ai: StagingField[];
}

export const TEXT_KINDS = [
	{ key: 'speech', label: 'Speech' },
	{ key: 'thought', label: 'Thought' },
	{ key: 'caption', label: 'Caption' },
	{ key: 'sfx', label: 'Sound effect' }
] as const;

export type TextKind = (typeof TEXT_KINDS)[number]['key'];

export const isTextKind = (v: unknown): v is TextKind => TEXT_KINDS.some((k) => k.key === v);

/** One balloon, caption or sound effect. Always the user's words. */
export interface TextBlock {
	id: string;
	kind: TextKind;
	/** The speaking character's id (speech, thought), or null. */
	speaker: number | null;
	text: string;
}

export const emptyPanel = (): Panel => ({
	shot: '',
	location: null,
	characters: [],
	action: '',
	cue: '',
	ai: []
});

const ids = (v: unknown): number[] =>
	Array.isArray(v)
		? [...new Set(v.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))]
		: [];

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Read a stored layout; anything malformed becomes an empty layout or is dropped. */
export function parseLayout(text: string | undefined): Layout {
	try {
		const raw = JSON.parse(text ?? '') as { pages?: unknown };
		const pages = Array.isArray(raw.pages) ? raw.pages : [];
		const seen = new Set<string>();
		const out: ScriptPage[] = [];
		for (const p of pages as Record<string, unknown>[]) {
			if (!p || !isId(p.id) || seen.has(p.id)) continue;
			seen.add(p.id);
			const panels = Array.isArray(p.panels)
				? (p.panels as unknown[]).filter((x): x is string => isId(x) && !seen.has(x))
				: [];
			panels.forEach((x) => seen.add(x));
			out.push({
				id: p.id,
				beat: str(p.beat),
				purpose: str(p.purpose),
				turn: p.turn === true,
				keyPanel: isId(p.keyPanel) && panels.includes(p.keyPanel) ? p.keyPanel : null,
				panels,
				seen: str(p.seen)
			});
		}
		return { pages: out };
	} catch {
		return { pages: [] };
	}
}

export function parsePanel(text: string | undefined): Panel {
	try {
		const p = JSON.parse(text ?? '') as Record<string, unknown>;
		const loc = Number(p.location);
		return {
			shot: isShot(p.shot) ? p.shot : '',
			location: Number.isSafeInteger(loc) && loc > 0 ? loc : null,
			characters: ids(p.characters),
			action: str(p.action),
			cue: str(p.cue),
			ai: Array.isArray(p.ai) ? STAGING_FIELDS.filter((f) => (p.ai as unknown[]).includes(f)) : []
		};
	} catch {
		return emptyPanel();
	}
}

export function parseWords(text: string | undefined): TextBlock[] {
	try {
		const raw = JSON.parse(text ?? '[]') as unknown;
		if (!Array.isArray(raw)) return [];
		return (raw as Record<string, unknown>[])
			.filter((b) => b && isId(b.id) && isTextKind(b.kind))
			.map((b) => {
				const speaker = Number(b.speaker);
				return {
					id: b.id as string,
					kind: b.kind as TextKind,
					speaker: Number.isSafeInteger(speaker) && speaker > 0 ? speaker : null,
					text: str(b.text)
				};
			});
	} catch {
		return [];
	}
}

/** A staging field is blank (the AI may fill it). */
export function isBlank(panel: Panel, field: StagingField): boolean {
	const v = panel[field];
	return Array.isArray(v) ? v.length === 0 : v === '' || v === null;
}

export const layoutText = (l: Layout) => JSON.stringify({ pages: l.pages });
export const panelText = (p: Panel) => JSON.stringify(p);
export const wordsText = (w: TextBlock[]) => JSON.stringify(w);

// ---------------------------------------------------------------------------
// What the script page shows (built by `getScript` in server/scripts.ts)

/** A versioned item's state, as `VersionNav` and friends show it (see server/versions.ts ItemView). */
export interface ScriptItemState {
	id: number;
	pending: boolean;
	error: string | null;
	/** Number of finished versions. */
	versions: number;
}

export interface PanelView {
	id: string;
	/** 1-based within its page. */
	number: number;
	panel: Panel;
	words: TextBlock[];
	isKey: boolean;
	/** The panel's item, or null before it is first saved. */
	item: ScriptItemState | null;
	wordsItem: ScriptItemState | null;
}

export interface PageView extends Omit<ScriptPage, 'panels'> {
	/** 1-based across the chapter, in reading order. */
	number: number;
	/** The beat's text changed since the page was laid out or checked. */
	beatChanged: boolean;
	/** A help job is working on this page. */
	pending: boolean;
	/** The last help job on this page failed with this error. */
	error: string | null;
	panels: PanelView[];
}

export interface BeatView {
	key: string;
	label: string;
	hint: string;
	/** What happens, from the plot's beat (empty if not written yet). */
	text: string;
	/** Pages the plot gives the beat. */
	plannedPages: number;
	/** Series character ids in the beat. */
	characters: number[];
	pages: PageView[];
	/** A help job is laying out this beat. */
	pending: boolean;
	error: string | null;
}

export interface ScriptDetail {
	readingDirection: 'rtl' | 'ltr';
	pageTarget: number;
	/** The plot has a structure with at least one written beat. */
	hasOutline: boolean;
	people: { id: number; name: string }[];
	places: { id: number; name: string }[];
	beats: BeatView[];
	/** Pages whose beat is no longer in the plot's outline. */
	orphans: PageView[];
	totals: { pages: number; panels: number; blocks: number };
	/** Some job is running: the page polls. */
	busy: boolean;
}
