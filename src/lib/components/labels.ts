/** "the description", "the description and the scene", "a, b and c". */
function list(items: string[]): string {
	return items.length < 2
		? (items[0] ?? '')
		: `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Why a version is out of date, from the labels of the inputs that changed. */
export function outOfDateText(changed: string[]): string {
	// 'unrecorded' is UNRECORDED from versions.ts, which can't be imported here.
	if (changed[0] === 'unrecorded')
		return 'Made before versions were kept: its inputs weren’t recorded.';
	return `Made before ${list(changed)} changed.`;
}
