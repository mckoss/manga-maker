import { test as base, expect, type Page } from '@playwright/test';
import { ADMIN } from './accounts';

export async function signIn(page: Page, account = ADMIN) {
	await page.goto('/login');
	await page.getByLabel('Username').fill(account.username);
	await page.getByLabel('Password').fill(account.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** A page already signed in as the admin. */
export const test = base.extend<{ signedIn: Page }>({
	signedIn: async ({ page }, use) => {
		await signIn(page);
		await use(page);
	}
});

export { expect };
