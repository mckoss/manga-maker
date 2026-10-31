import { expect, signIn, test } from './fixtures';

test('sends visitors to the sign-in page', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login\?next=%2F$/);
});

test('rejects a wrong password', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('Username').fill('admin@example.com');
	await page.getByLabel('Password').fill('not the password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
});

test('signs in and out', async ({ page }) => {
	await signIn(page);
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);
});
