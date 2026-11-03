import type { ItemView } from '#lib/server/versions.js';

/** Unlocked artifacts that are not created yet, and those out of date. */
export function pendingWork(items: ItemView[]): { missing: number; stale: number } {
	let missing = 0;
	let stale = 0;
	for (const item of items) {
		if (item.locked || item.pending) continue;
		const current = item.versions.find((v) => v.id === item.currentId);
		if (!current) missing++;
		else if (current.outOfDate.length) stale++;
	}
	return { missing, stale };
}

const plural = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;

/**
 * What a batch button does, in the app's two verbs: "Generate 3 scenes",
 * "Regenerate 2 out-of-date pictures", "Generate 1 and regenerate 2 views".
 * Empty when there is nothing to do.
 */
export function batchLabel(work: { missing: number; stale: number }, noun: string): string {
	const { missing, stale } = work;
	if (missing && stale) return `Generate ${missing} and regenerate ${plural(stale, noun)}`;
	if (missing) return `Generate ${plural(missing, noun)}`;
	if (stale) return `Regenerate ${stale} out-of-date ${stale === 1 ? noun : `${noun}s`}`;
	return '';
}

/**
 * The pipeline's "do everything" button: "Generate everything" until
 * something already made goes out of date. Steps the user chooses (notes,
 * the reference) are never generated, so they don't count.
 */
export function everythingLabel(steps: { missing: number; stale: number }[]): string {
	const missing = steps.reduce((n, s) => n + s.missing, 0);
	const stale = steps.reduce((n, s) => n + s.stale, 0);
	if (!stale) return 'Generate everything';
	if (!missing) return 'Regenerate everything out of date';
	return 'Generate and regenerate everything';
}
