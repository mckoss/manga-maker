import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { authenticate } from '#lib/server/auth/users.js';
import { createSession, SESSION_COOKIE } from '#lib/server/auth/sessions.js';
import { loginLimiter } from '#lib/server/auth/rate-limit.js';
import { normalizeUsername } from '#lib/server/auth/username.js';
import type { Actions, PageServerLoad } from './$types';

/** Only follow same-site relative paths after sign-in. */
function safeNext(next: string | null): string {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const username = normalizeUsername(String(form.get('username') ?? ''));
		const password = String(form.get('password') ?? '');

		const wait = loginLimiter.retryAfter(username);
		if (wait > 0) {
			const minutes = Math.ceil(wait / 60000);
			return fail(429, { username, error: `Too many attempts. Try again in ${minutes} min.` });
		}

		const db = getDb();
		const user = await authenticate(db, username, password);
		if (!user) {
			loginLimiter.fail(username);
			return fail(400, { username, error: 'Incorrect username or password.' });
		}
		loginLimiter.reset(username);

		const { token, expiresAt } = createSession(db, user.id);
		cookies.set(SESSION_COOKIE, token, { path: '/', expires: expiresAt });
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
