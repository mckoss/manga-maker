import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '#lib/server/auth/sessions.js';
import { authenticate, setPassword, UserError } from '#lib/server/auth/users.js';
import { setUserImageModel, userImageModel } from '#lib/server/models.js';
import { imageModelOptions, isImageModel } from '#lib/models.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	imageModel: userImageModel(getDb(), locals.user!.id),
	imageModels: imageModelOptions()
});

export const actions: Actions = {
	imageModel: async ({ request, locals }) => {
		const model = String((await request.formData()).get('imageModel') ?? '');
		if (!isImageModel(model)) return fail(400, { error: 'Choose an image model.' });
		setUserImageModel(getDb(), locals.user!.id, model);
		return { message: 'Default image model saved.' };
	},
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
