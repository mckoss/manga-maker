import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const STEPS = ['Style', 'Characters', 'Locations', 'Plot', 'Script', 'Panels', 'Pages'];

async function newManga(page: Page, title: string) {
	await page.goto('/');
	await page.getByRole('link', { name: 'New manga' }).first().click();
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Create manga' }).click();
	await expect(page.getByRole('heading', { name: 'Style', level: 1 })).toBeVisible();
}

/** Start a style, let the (fake) AI draft it, sample it and approve it. */
async function approveStyle(page: Page) {
	await page.getByLabel('Describe the look').fill('Edo-period ink, villages, kimono');
	await page.getByRole('button', { name: 'Start the style' }).click();
	await expect(page.getByLabel('Style prompt')).not.toHaveValue('');
	await page.getByRole('button', { name: 'Generate samples' }).click();
	await expect(page.getByRole('button', { name: 'Approve this style' })).toBeEnabled();
	await page.getByRole('button', { name: 'Approve this style' }).click();
	await expect(page.getByText('v1 approved')).toBeVisible();
}

test('creates a manga and walks its steps', async ({ signedIn: page }) => {
	await newManga(page, 'Ronin Road');
	const steps = page.getByRole('navigation', { name: 'Steps' });
	for (const step of STEPS) await expect(steps.getByRole('link', { name: step })).toBeVisible();
	await expect(steps.getByText('not started')).toBeVisible();

	for (const step of STEPS.slice(1)) {
		await steps.getByRole('link', { name: step }).click();
		await expect(page.getByRole('heading', { name: step, level: 1 })).toBeVisible();
		await expect(page.getByText('Not built yet.')).toBeVisible();
	}

	await steps.getByRole('link', { name: 'Ronin Road' }).click();
	await page.getByLabel('Logline').fill('A swordsman walks home.');
	await page.getByLabel('Left to right').check();
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Left to right')).toBeChecked();
});

test('approves a style and shows it as the cover', async ({ signedIn: page }) => {
	await newManga(page, 'Cover Test');
	await approveStyle(page);
	await expect(page.getByRole('navigation', { name: 'Steps' }).getByText('approved')).toBeVisible();

	await page.getByRole('link', { name: 'My manga' }).click();
	const card = page.getByRole('link', { name: /Cover Test/ });
	await expect(card.getByText('Style approved')).toBeVisible();
	await expect(card.locator('img')).toHaveJSProperty('complete', true);
});

test("reuses another manga's style", async ({ signedIn: page }) => {
	await newManga(page, 'Original');
	await approveStyle(page);
	await newManga(page, 'Sequel');
	await page
		.getByRole('listitem')
		.filter({ hasText: 'Original' })
		.getByRole('button', { name: 'Use this style' })
		.click();
	await expect(page.getByText('Style copied.')).toBeVisible();
	await expect(page.getByText('v1 approved')).toBeVisible();
});

test('deletes a manga', async ({ signedIn: page }) => {
	await newManga(page, 'Doomed');
	await page
		.getByRole('navigation', { name: 'Steps' })
		.getByRole('link', { name: 'Doomed' })
		.click();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete this manga' }).click();
	await expect(page.getByRole('heading', { name: 'My manga' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Doomed/ })).toHaveCount(0);
});
