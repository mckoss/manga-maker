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
	const profile = page.locator('form[action="?/save"]');
	await expect(profile.getByLabel('Appearance')).toHaveValue(/long black hair/);
	await expect(page.getByText('AI story editor:')).toBeVisible();

	// The designs are written with the profile, ready to read and edit.
	await expect(page.getByText('Not drawn yet')).toHaveCount(4);
	await profile.getByLabel('Outfit and props').fill('a red traveling kimono');
	await expect(page.getByText('Unsaved changes')).toBeVisible();
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(
		page.getByText('The look changed, so the AI is writing new design options.')
	).toBeVisible();

	// One design, edited and drawn on its own; then the rest.
	const first = page.getByRole('figure').filter({ hasText: 'close to the profile' });
	await first.getByLabel('Appearance').fill('a giant of a woman with a shaved head');
	await first.getByRole('button', { name: 'Draw close to the profile' }).click();
	await expect(page.getByRole('img', { name: 'Design option 1' })).toBeVisible();
	await expect(page.getByText('Not drawn yet')).toHaveCount(3);
	await page.getByRole('button', { name: 'Draw all 3 designs' }).click();
	const options = page.getByRole('button', { name: 'Use as reference' });
	await expect(options).toHaveCount(4);
	await first.getByText('Edit and redraw…').click();
	await expect(first.getByLabel('Appearance')).toHaveValue('a giant of a woman with a shaved head');
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
	await expect(page.getByRole('button', { name: 'Draw the designs' })).toBeDisabled();
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
