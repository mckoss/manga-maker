import { redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { deleteSession, SESSION_COOKIE } from '#lib/server/auth/sessions.js';
import type { Actions } from './$types';

export const actions: Actions = {
	default: ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) deleteSession(getDb(), token);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
};
