import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { ChapterError, ownedChapter } from '#lib/server/chapters.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals, parent }) => {
	const { series } = await parent();
	try {
		return { chapter: ownedChapter(getDb(), locals.user!.id, series.id, Number(params.ch)) };
	} catch (e) {
		if (e instanceof ChapterError) error(404, e.message);
		throw e;
	}
};
