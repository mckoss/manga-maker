/**
 * Typed ids for versioned items. A scope names what items belong to
 * ("character:12"); a slot names one item in it ("design:3", or just "name"
 * when the kind has no key). Build and read them here, never with template
 * literals and `split(':')` by hand.
 */

export const SCOPE_KINDS = ['character', 'location', 'chapter', 'style', 'series'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** A scope string, "<kind>:<id>". */
export type Scope<K extends ScopeKind = ScopeKind> = `${K}:${number}`;

export class IdError extends Error {}

function checkId(id: number): number {
	if (!Number.isSafeInteger(id) || id < 0) throw new IdError(`Bad id: ${id}`);
	return id;
}

const scopeFor =
	<K extends ScopeKind>(kind: K) =>
	(id: number): Scope<K> =>
		`${kind}:${checkId(id)}`;

/** Build a scope: `scopeOf.character(12)` is "character:12". */
export const scopeOf: { [K in ScopeKind]: (id: number) => Scope<K> } = {
	character: scopeFor('character'),
	location: scopeFor('location'),
	chapter: scopeFor('chapter'),
	style: scopeFor('style'),
	series: scopeFor('series')
};

export function isScopeKind(value: string): value is ScopeKind {
	return (SCOPE_KINDS as readonly string[]).includes(value);
}

/** Read a scope string; throws on anything that isn't one. */
export function parseScope(s: string): { kind: ScopeKind; id: number } {
	const match = /^([a-z]+):(\d+)$/.exec(s);
	if (!match || !isScopeKind(match[1])) throw new IdError(`Bad scope: ${s}`);
	const id = Number(match[2]);
	return { kind: match[1], id: checkId(id) };
}

/** One item in a scope: its kind, and its key when the kind has several. */
export interface SlotRef {
	kind: string;
	key: string | null;
}

const PART = /^[a-z0-9][a-z0-9_-]*$/i;

function checkPart(part: string, what: string): string {
	if (!PART.test(part)) throw new IdError(`Bad slot ${what}: ${part}`);
	return part;
}

/** A slot ref; an empty key (as items store "no key") means none. */
export function slot(kind: string, key?: string | null): SlotRef {
	return { kind: checkPart(kind, 'kind'), key: key ? checkPart(key, 'key') : null };
}

/** Read a slot string, "kind" or "kind:key"; throws on junk. */
export function parseSlot(s: string): SlotRef {
	const parts = s.split(':');
	if (parts.length > 2) throw new IdError(`Bad slot: ${s}`);
	return slot(parts[0], parts[1] === undefined ? null : parts[1] || checkPart('', 'key'));
}

/** The slot string, "kind" or "kind:key", as `currentVersions` and `describeScope` key items. */
export function slotKey(ref: SlotRef): string {
	const { kind, key } = slot(ref.kind, ref.key);
	return key ? `${kind}:${key}` : kind;
}

export const sameSlot = (a: SlotRef, b: SlotRef) => a.kind === b.kind && a.key === b.key;

/** The slot string for a kind and optional key: `slotKeyOf('design', '3')` is "design:3". */
export const slotKeyOf = (kind: string, key?: string | null) => slotKey(slot(kind, key));
