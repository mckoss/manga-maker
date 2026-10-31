import { test as base, expect, type Page } from '@playwright/test';
import { ADMIN } from './accounts';

export async function signIn(page: Page, account = ADMIN) {
	await page.goto('/login');
	await page.getByLabel('Username').fill(account.username);
	await page.getByLabel('Password').fill(account.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

export const test = base.extend<{ signedIn: Page; noPageErrors: void }>({
	/** Fail any test whose page throws an uncaught error in the browser. */
	noPageErrors: [
		async ({ page }, use) => {
			const errors: Error[] = [];
			page.on('pageerror', (e) => errors.push(e));
			await use();
			expect(errors.map((e) => e.message)).toEqual([]);
		},
		{ auto: true }
	],
	/** A page already signed in as the admin. */
	signedIn: async ({ page }, use) => {
		await signIn(page);
		await use(page);
	}
});

export { expect };
