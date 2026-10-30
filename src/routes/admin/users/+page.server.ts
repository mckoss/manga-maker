import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { isAdmin } from '#lib/server/auth/admins.js';
import {
	createUser,
	deleteUser,
	listUsers,
	setPassword,
	UserError
} from '#lib/server/auth/users.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	users: listUsers(getDb()).map((u) => ({ ...u, isAdmin: isAdmin(u.username) }))
});

/** Run a user operation, turning validation errors into a form failure. */
async function attempt(action: string, fn: () => Promise<string>) {
	try {
		return { action, message: await fn() };
	} catch (e) {
		if (e instanceof UserError) return fail(400, { action, error: e.message });
		throw e;
	}
}

export const actions: Actions = {
	add: async ({ request }) => {
		const form = await request.formData();
		return attempt('add', async () => {
			const user = await createUser(
				getDb(),
				String(form.get('username') ?? ''),
				String(form.get('password') ?? '')
			);
			return `Added ${user.username}.`;
		});
	},
	reset: async ({ request }) => {
		const form = await request.formData();
		return attempt('reset', async () => {
			await setPassword(getDb(), Number(form.get('id')), String(form.get('password') ?? ''));
			return `Password reset for ${form.get('username')}; their sessions were signed out.`;
		});
	},
	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (id === locals.user!.id) {
			return fail(400, { action: 'delete', error: 'You cannot delete your own account.' });
		}
		deleteUser(getDb(), id);
		return { action: 'delete', message: `Deleted ${form.get('username')}.` };
	}
};
