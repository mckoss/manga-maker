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
	await page.getByRole('button', { name: 'Generate 5 pictures' }).click();
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
	await expect(page.locator('.designs .placeholder', { hasText: 'Not created' })).toHaveCount(4);
	// Nothing made yet is out of date: the pipeline button only generates.
	await expect(page.getByRole('button', { name: 'Generate everything' })).toBeVisible();
	await expect(page.locator('.flow, #designs').getByText(/out of date/i)).toHaveCount(0);
	const flow = page.getByRole('navigation', { name: 'How the character is made' });
	await expect(flow.getByRole('listitem').filter({ hasText: 'Profile' })).toContainText(
		'up to date'
	);

	// Changing the notes marks the profile out of date; nothing is rewritten yet.
	// Leaving a changed box saves it.
	const notes = page.locator('#notes').getByLabel('Your notes', { exact: true });
	await notes.fill('a runaway boy with a staff');
	await notes.blur();
	await expect(flow.getByRole('listitem').filter({ hasText: 'Profile' })).toContainText(
		// The name is canonical once given, so it stays locked.
		'7 to update · 1 locked'
	);
	await expect(profile.getByText('Out of date').first()).toBeVisible();

	// The user's own wording of a field is kept.
	const outfit = profile.getByLabel('Outfit and props', { exact: true });
	await outfit.fill('a red traveling kimono');
	await outfit.blur();
	await expect(profile.getByText('Locked', { exact: true })).toBeVisible();

	// Regenerate everything: the profile, then the designs, then their pictures.
	await page.getByRole('button', { name: 'Generate and regenerate everything' }).click();
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

	// The chosen design is marked at the top of its box and among the options above the sheet.
	await expect(page.locator('#designs .design.reference')).toHaveCount(1);
	await expect(page.locator('#designs .design.reference .banner')).toHaveText('Chosen reference');
	const choices = page.getByRole('group', { name: 'Reference options' });
	await expect(choices.getByRole('img')).toHaveCount(4);
	await expect(choices.getByText('Chosen reference')).toHaveCount(1);
	// Choosing from the options above the sheet moves the reference (the fake
	// AI draws designs 1 and 2 alike, so pick the last, which differs).
	const before = await page.locator('#designs .design.reference').getAttribute('id');
	await choices
		.getByRole('button', { name: /^Choose .* as reference$/ })
		.last()
		.click();
	await expect(page.locator('#designs .design.reference')).not.toHaveAttribute('id', before ?? '');
	await expect(choices.getByRole('button', { name: /^Choose .* as reference$/ })).toHaveCount(3);
	await expect(page.locator('#designs .design.reference')).toHaveCount(1);

	await page.getByRole('button', { name: 'Generate the character sheet' }).click();
	await expect(page.getByRole('img', { name: 'Aiko: Back' })).toBeVisible();
	await expect(page.getByRole('img', { name: /^Aiko: / })).toHaveCount(8);
	const side = page.locator('#sheet figure').filter({ hasText: 'Side' });
	await expect(side.getByRole('button', { name: 'Regenerate Side' })).toHaveCount(0);
	await side.getByLabel('Amendment for Side').fill('looking over her shoulder');
	await side.getByRole('button', { name: 'Regenerate Side' }).click();
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
	await expect(page.getByRole('button', { name: /pictures/ })).toHaveCount(0);
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

test('draws a series logo from the protagonist, used across the series', async ({
	signedIn: page
}) => {
	await newSeries(page, 'Logo Test');
	await readyStyle(page);
	const logo = page.locator('section').filter({ hasText: '4. Series logo' });
	await expect(logo.getByText('None with a reference picture yet')).toBeVisible();
	await expect(logo.getByRole('button', { name: 'Generate the logo' })).toHaveCount(0);

	await steps(page).getByRole('link', { name: 'Characters' }).click();
	await page.getByLabel('Describe them').fill('a runaway girl with a staff');
	await page.getByRole('button', { name: 'Add character' }).click();
	await expect(page.getByRole('heading', { name: 'Aiko', level: 1 })).toBeVisible();
	await page.getByRole('button', { name: 'Generate everything' }).click();
	const options = page.getByRole('button', { name: /^Use design \d as reference$/ });
	await expect(options).toHaveCount(4);
	await options.first().click();
	await expect(page.getByText('Reference picture chosen.')).toBeVisible();

	await steps(page).getByRole('link', { name: 'Style' }).click();
	await expect(logo.getByRole('link', { name: 'Aiko' })).toBeVisible();
	await logo.getByRole('button', { name: 'Generate the logo' }).click();
	await expect(logo.getByRole('img', { name: 'Series logo' })).toBeVisible();
	await expect(logo.getByText('Version 1 of 1')).toBeVisible();
	// The logo stands for the series in the sidebar and on the overview.
	await expect(steps(page).locator('img.logo')).toBeVisible();
	await steps(page).getByRole('link', { name: 'Logo Test' }).click();
	await expect(page.getByRole('img', { name: 'Logo Test logo' })).toBeVisible();
});
