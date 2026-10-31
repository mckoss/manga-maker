import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function newManga(page: Page, title: string) {
	await page.goto('/manga/new');
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Create manga' }).click();
	await expect(page.getByRole('heading', { name: 'Style', level: 1 })).toBeVisible();
}

async function approveStyle(page: Page) {
	await page.getByLabel('Describe the look').fill('Edo-period ink');
	await page.getByRole('button', { name: 'Start the style' }).click();
	await expect(page.getByLabel('Style prompt')).not.toHaveValue('');
	await page.getByRole('button', { name: 'Generate samples' }).click();
	await page.getByRole('button', { name: 'Approve this style' }).click();
	await expect(page.getByText('v1 approved')).toBeVisible();
}

function steps(page: Page) {
	return page.getByRole('navigation', { name: 'Steps' });
}

test('builds a character and chooses a reference picture', async ({ signedIn: page }) => {
	await newManga(page, 'Cast Test');
	await approveStyle(page);
	await steps(page).getByRole('link', { name: 'Characters' }).click();
	await expect(page.getByRole('heading', { name: 'Characters', level: 1 })).toBeVisible();

	await page.getByLabel('Describe them').fill('a runaway girl with a staff');
	await page.getByRole('button', { name: 'Add character' }).click();

	// The (fake) AI fills in the profile, including a name.
	await expect(page.getByRole('heading', { name: 'Aiko', level: 1 })).toBeVisible();
	await expect(page.getByLabel('Appearance')).toHaveValue(/long black hair/);
	await expect(page.getByText('AI story editor:')).toBeVisible();

	await page.getByLabel('Outfit and props').fill('a red travelling kimono');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	await page.getByRole('button', { name: 'Draw design options' }).click();
	const options = page.getByRole('button', { name: 'Use as reference' });
	await expect(options).toHaveCount(4);
	await options.nth(1).click();
	await expect(page.getByText('Reference picture chosen.')).toBeVisible();
	await expect(page.getByRole('img', { name: 'Aiko reference' })).toBeVisible();
	await expect(steps(page).getByText('1/1')).toBeVisible();

	await page.getByRole('link', { name: '← Characters' }).click();
	await expect(
		page.getByRole('link', { name: /Aiko/ }).getByText('reference chosen')
	).toBeVisible();
});

test('asks for an approved style before drawing', async ({ signedIn: page }) => {
	await newManga(page, 'No Style Yet');
	await steps(page).getByRole('link', { name: 'Characters' }).click();
	await expect(page.getByText('approve a style')).toBeVisible();
	await page.getByLabel('Name (optional)').fill('Goro');
	await page.getByRole('button', { name: 'Add character' }).click();
	await expect(page.getByRole('heading', { name: 'Goro', level: 1 })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Draw design options' })).toBeDisabled();
});

test('deletes a character', async ({ signedIn: page }) => {
	await newManga(page, 'Delete Cast');
	await steps(page).getByRole('link', { name: 'Characters' }).click();
	await page.getByLabel('Name (optional)').fill('Temp');
	await page.getByRole('button', { name: 'Add character' }).click();
	await expect(page.getByRole('heading', { name: 'Temp', level: 1 })).toBeVisible();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete character' }).click();
	await expect(page.getByRole('heading', { name: 'Characters', level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: /Temp/ })).toHaveCount(0);
});
