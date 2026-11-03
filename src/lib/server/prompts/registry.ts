import { createHash } from 'node:crypto';

/**
 * A system prompt for one AI text step, fixed when its module loads. Its
 * hash is a short content hash of the exact text, recorded on every version
 * the step makes, so a version can say it was made with an earlier text.
 */
export interface Prompt<I extends string = string> {
	readonly id: I;
	readonly text: string;
	readonly hash: string;
}

/** The first 12 hex digits of the SHA-256 of the exact text. */
export function promptHash(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** A prompt with a stable, namespaced id ("character.develop"). */
export function definePrompt<const I extends string>(id: I, text: string): Prompt<I> {
	if (!/^[a-z]+(\.[a-z]+)+$/.test(id)) throw new Error(`Bad prompt id "${id}".`);
	return Object.freeze({ id, text, hash: promptHash(text) });
}

/** The prompts by id. Two prompts with the same id are a mistake, caught at load. */
export function promptTable<P extends Prompt>(prompts: readonly P[]): ReadonlyMap<string, P> {
	const table = new Map<string, P>();
	for (const p of prompts) {
		if (table.has(p.id)) throw new Error(`The prompt "${p.id}" is defined twice.`);
		table.set(p.id, p);
	}
	return table;
}
