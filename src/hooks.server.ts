import { error, redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { getDb } from '#lib/server/db/index.js';
import { isCrossSiteWrite } from '#lib/server/csrf.js';
import { startWorker } from '#lib/server/worker.js';
import { isAdmin } from '#lib/server/auth/admins.js';
import {
	SESSION_COOKIE,
	sessionCookieOptions,
	validateSession
} from '#lib/server/auth/sessions.js';

export const init: ServerInit = () => {
	startWorker();
};

/** Routes reachable without signing in. */
const PUBLIC_PATHS = ['/login'];

export const handle: Handle = async ({ event, resolve }) => {
	if (isCrossSiteWrite(event.request, event.url.host)) {
		error(403, 'Cross-site requests are not allowed.');
	}

	event.locals.user = null;
	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = validateSession(getDb(), token);
		if (session) {
			const { user } = session;
			event.locals.user = { ...user, isAdmin: isAdmin(user.username) };
			if (session.renewed) {
				event.cookies.set(
					SESSION_COOKIE,
					token,
					sessionCookieOptions(event.url, session.expiresAt)
				);
			}
		} else {
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
		}
	}

	const { pathname, search } = event.url;
	if (!event.locals.user && !PUBLIC_PATHS.includes(pathname)) {
		redirect(303, `/login?next=${encodeURIComponent(pathname + search)}`);
	}
	if (pathname.startsWith('/admin') && !event.locals.user?.isAdmin) {
		redirect(303, '/');
	}
	return resolve(event);
};
