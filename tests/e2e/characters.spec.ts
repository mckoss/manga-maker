import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function newSeries(page: Page, title: string) {
	await page.goto('/series/new');
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Create series' }).click();
	await expect(page.getByRole('heading', { name: 'Style', level: 1 })).toBeVisible();
}

async function readyStyle(page: Page) {
	await page.getByLabel('Describe the look').fill('Edo-period ink');
	await page.getByRole('button', { name: 'Start the style' }).click();
	await page.getByRole('button', { name: /Draw missing and out-of-date pictures/ }).click();
	await expect(page.getByRole('img', { name: 'Action sample' })).toBeVisible();
}

function steps(page: Page) {
	return page.getByRole('navigation', { name: 'Steps' });
}

test('builds a character and chooses a reference picture', async ({ signedIn: page }) => {
	await newSeries(page, 'Cast Test');
	await readyStyle(page);
	await steps(page).getByRole('link', { name: 'Characters' }).click();
	await expect(page.getByRole('heading', { name: 'Characters', level: 1 })).toBeVisible();

	await page.getByLabel('Describe them').fill('a runaway girl with a staff');
	await page.getByRole('button', { name: 'Add character' }).click();

	// The (fake) AI fills in the profile, including a name.
	await expect(page.getByRole('heading', { name: 'Aiko', level: 1 })).toBeVisible();
	await expect(page.getByLabel('Appearance')).toHaveValue(/long black hair/);
	await expect(page.getByText('AI story editor:')).toBeVisible();

	await page.getByLabel('Outfit and props').fill('a red traveling kimono');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	await page.getByRole('button', { name: 'Draw design options' }).click();
	const options = page.getByRole('button', { name: 'Use as reference' });
	await expect(options).toHaveCount(4);
	await options.nth(1).click();
	await expect(page.getByText('Reference picture chosen.')).toBeVisible();
	await expect(page.getByRole('img', { name: 'Aiko reference' })).toBeVisible();
	await expect(steps(page).getByText('1/1')).toBeVisible();

	await page.getByRole('button', { name: 'Draw the character sheet' }).click();
	await expect(page.getByRole('img', { name: 'Aiko: Back' })).toBeVisible();
	await expect(page.getByRole('img', { name: /^Aiko: / })).toHaveCount(8);
	const side = page.getByRole('figure').filter({ hasText: 'Side' });
	await side.getByText('Redraw…').click();
	await side.getByLabel('Guidance (optional)').fill('looking over her shoulder');
	await side.getByRole('button', { name: 'Redraw Side' }).click();
	await expect(page.getByRole('img', { name: 'Aiko: Side' })).toBeVisible();

	await page.getByRole('link', { name: '← Characters' }).click();
	await expect(
		page.getByRole('link', { name: /Aiko/ }).getByText('reference chosen')
	).toBeVisible();
});

test('asks for a style sample before drawing', async ({ signedIn: page }) => {
	await newSeries(page, 'No Style Yet');
	await steps(page).getByRole('link', { name: 'Characters' }).click();
	await expect(page.getByText('draw a sample picture of the style')).toBeVisible();
	await page.getByLabel('Name (optional)').fill('Goro');
	await page.getByRole('button', { name: 'Add character' }).click();
	await expect(page.getByRole('heading', { name: 'Goro', level: 1 })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Draw design options' })).toBeDisabled();
});

test('deletes a character', async ({ signedIn: page }) => {
	await newSeries(page, 'Delete Cast');
	await steps(page).getByRole('link', { name: 'Characters' }).click();
	await page.getByLabel('Name (optional)').fill('Temp');
	await page.getByRole('button', { name: 'Add character' }).click();
	await expect(page.getByRole('heading', { name: 'Temp', level: 1 })).toBeVisible();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete character' }).click();
	await expect(page.getByRole('heading', { name: 'Characters', level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: /Temp/ })).toHaveCount(0);
});
