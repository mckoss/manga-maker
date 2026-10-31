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

test('builds a character through its pipeline and chooses a reference picture', async ({
	signedIn: page
}) => {
	await newSeries(page, 'Cast Test');
	await readyStyle(page);
	await steps(page).getByRole('link', { name: 'Characters' }).click();
	await expect(page.getByRole('heading', { name: 'Characters', level: 1 })).toBeVisible();

	await page.getByLabel('Describe them').fill('a runaway girl with a staff');
	await page.getByRole('button', { name: 'Add character' }).click();

	// The (fake) AI writes the profile, including a name, then the designs.
	await expect(page.getByRole('heading', { name: 'Aiko', level: 1 })).toBeVisible();
	const profile = page.locator('#profile');
	await expect(profile.getByLabel('Appearance', { exact: true })).toHaveValue(/long black hair/);
	await expect(page.getByText('AI story editor:')).toBeVisible();
	await expect(page.getByText('Not drawn yet')).toHaveCount(4);
	const flow = page.getByRole('navigation', { name: 'How the character is made' });
	await expect(flow.getByRole('listitem').filter({ hasText: 'Profile' })).toContainText(
		'up to date'
	);

	// Changing the notes marks the profile out of date; nothing is rewritten yet.
	await page
		.locator('#notes')
		.getByLabel('Your notes', { exact: true })
		.fill('a runaway boy with a staff');
	await page.getByRole('button', { name: 'Save your notes' }).click();
	await expect(flow.getByRole('listitem').filter({ hasText: 'Profile' })).toContainText(
		'8 to update'
	);
	await expect(profile.getByText('Out of date').first()).toBeVisible();

	// The user's own wording of a field is kept.
	await profile.getByLabel('Outfit and props', { exact: true }).fill('a red traveling kimono');
	await page.getByRole('button', { name: 'Save outfit and props' }).click();
	await expect(profile.getByText('Kept', { exact: true })).toBeVisible();

	// Update everything: the profile, then the designs, then their pictures.
	await page.getByRole('button', { name: 'Update everything not kept' }).click();
	const options = page.getByRole('button', { name: /^Use design \d as reference$/ });
	await expect(options).toHaveCount(4);
	await expect(flow.getByRole('listitem').filter({ hasText: 'Option pictures' })).toContainText(
		'up to date'
	);
	await expect(profile.getByLabel('Outfit and props', { exact: true })).toHaveValue(
		'a red traveling kimono'
	);
	await expect(profile.getByText('Version 2 of 2').first()).toBeVisible();

	await options.nth(1).click();
	await expect(page.getByText('Reference picture chosen.')).toBeVisible();
	await expect(page.getByRole('img', { name: 'Aiko reference' })).toBeVisible();
	await expect(steps(page).getByText('1/1')).toBeVisible();

	await page.getByRole('button', { name: 'Draw the character sheet' }).click();
	await expect(page.getByRole('img', { name: 'Aiko: Back' })).toBeVisible();
	await expect(page.getByRole('img', { name: /^Aiko: / })).toHaveCount(8);
	const side = page.locator('#sheet figure').filter({ hasText: 'Side' });
	await side.getByText('Redraw…').click();
	await side.getByLabel('Guidance (optional)').fill('looking over her shoulder');
	await side.getByRole('button', { name: 'Redraw Side' }).click();
	await expect(side.getByText('Version 2 of 2')).toBeVisible();

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
	await expect(page.getByRole('button', { name: 'Draw out-of-date pictures' })).toBeDisabled();
	await expect(page.getByText('start the style')).toBeVisible();
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
