import { getDb } from '#lib/server/db/index.js';
import { activeCount } from '#lib/server/queue.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	const { user } = locals;
	// Reading the path reruns this on every navigation, keeping the header's
	// count of waiting and running jobs fresh (a cheap query).
	void url.pathname;
	return {
		user,
		queued: user ? activeCount(getDb(), { id: user.id, isAdmin: user.isAdmin }) : 0
	};
};
