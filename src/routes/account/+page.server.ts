import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '#lib/server/auth/sessions.js';
import { authenticate, setPassword, UserError } from '#lib/server/auth/users.js';
import type { Actions } from './$types';

export const actions: Actions = {
	password: async ({ request, locals, cookies, url }) => {
		const user = locals.user!;
		const form = await request.formData();
		const current = String(form.get('current') ?? '');
		const next = String(form.get('next') ?? '');
		if (next !== String(form.get('confirm') ?? '')) {
			return fail(400, { error: 'The new passwords do not match.' });
		}
		const db = getDb();
		if (!(await authenticate(db, user.username, current))) {
			return fail(400, { error: 'Current password is incorrect.' });
		}
		try {
			await setPassword(db, user.id, next);
		} catch (e) {
			if (e instanceof UserError) return fail(400, { error: e.message });
			throw e;
		}
		// setPassword signs out every session; start a fresh one for this browser.
		const { token, expiresAt } = createSession(db, user.id);
		cookies.set(SESSION_COOKIE, token, sessionCookieOptions(url, expiresAt));
		return { message: 'Password changed. Other devices have been signed out.' };
	}
};
