import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function newStyle(page: Page, title: string) {
	await page.goto('/series/new');
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Create series' }).click();
	await page.getByLabel('Describe the look').fill('Edo-period ink, villages, kimono');
	await page.getByRole('button', { name: 'Start the style' }).click();
	await page.getByRole('button', { name: /Draw missing and out-of-date pictures/ }).click();
	await expect(page.getByRole('img', { name: 'Action sample' })).toBeVisible();
}

const picture = (page: Page, label: string) =>
	page.locator('.picture').filter({ has: page.getByText(label, { exact: true }) });

test('keeps versions of a picture, goes back to one and locks it in', async ({
	signedIn: page
}) => {
	await newStyle(page, 'Versions');
	const face = picture(page, 'Face');
	await face.getByText('Redraw…').click();
	await face.getByLabel('Seed', { exact: true }).fill('12345');
	await face.getByLabel('Guidance (optional)').fill('looking up at the sky');
	await face.getByRole('button', { name: 'Redraw Face' }).click();
	await expect(face.getByText('2 of 2')).toBeVisible();
	await expect(face.getByText('Seed 12345')).toBeVisible();
	await expect(face.getByText('Guidance: looking up at the sky')).toBeVisible();

	await face.getByRole('button', { name: 'Older version of Face' }).click();
	await expect(face.getByText('1 of 2')).toBeVisible();
	await expect(face.getByText('not in use')).toBeVisible();
	await face.getByRole('button', { name: 'Use and lock' }).click();
	await expect(page.getByText('Using that version, locked.')).toBeVisible();
	await expect(face.getByText('Locked', { exact: true })).toBeVisible();
	await expect(face.getByText('Redraw…')).toHaveCount(0);

	// Deleting a locked version asks first.
	page.once('dialog', (dialog) => dialog.accept());
	await face.getByRole('button', { name: 'Delete this version of Face' }).click();
	await expect(page.getByText('Version deleted.')).toBeVisible();
	// The newer version, still locked, is the only one left.
	await expect(face.getByText('Seed 12345')).toBeVisible();
	await expect(face.getByText('Locked', { exact: true })).toBeVisible();
	await expect(face.getByRole('button', { name: 'Older version of Face' })).toHaveCount(0);
});

test('marks later steps out of date and regenerates only those', async ({ signedIn: page }) => {
	await newStyle(page, 'Out of date');
	await page
		.getByRole('textbox', { name: 'Description', exact: true })
		.fill('Edo-period ink, fishing villages, winter');
	await page.getByRole('button', { name: 'Save description' }).click();
	await expect(page.getByText('Made before the description changed.').first()).toBeVisible();

	const prompt = page
		.locator('.item')
		.filter({ has: page.getByRole('textbox', { name: 'Style prompt', exact: true }) });
	await prompt.getByText('Rewrite the prompt…').click();
	await prompt.getByLabel('Guidance for the AI (optional)').fill('heavier blacks');
	await prompt.getByRole('button', { name: 'Rewrite the prompt' }).click();
	await expect(prompt.getByText('2 of 2')).toBeVisible();
	await expect(
		picture(page, 'Figure').getByText('Made before the style prompt changed.')
	).toBeVisible();

	await page.getByRole('button', { name: 'Draw missing and out-of-date pictures (5)' }).click();
	await expect(picture(page, 'Action').getByText('2 of 2')).toBeVisible();
	await expect(page.getByText('Made before the style prompt changed.')).toHaveCount(0);
});

test('folds answers to the art director’s questions into the description', async ({
	signedIn: page
}) => {
	await newStyle(page, 'Questions');
	await expect(page.getByText('Which era is it set in?')).toBeVisible();
	await page.getByRole('button', { name: 'The 1860s' }).click();
	await page
		.getByRole('textbox', { name: 'Answer: What kind of story is it?' })
		.fill('A quiet village drama');
	await page.getByRole('button', { name: 'Add my answers to the description' }).click();

	const description = page.getByRole('textbox', { name: 'Description', exact: true });
	await expect(description).toHaveValue(/The 1860s.*A quiet village drama/);
	await expect(page.getByText('Which era is it set in?')).toHaveCount(0);
	await expect(page.getByText('Made before the description changed.').first()).toBeVisible();

	await page.getByRole('button', { name: "Ask the art director what's missing" }).click();
	await expect(page.getByText('Which era is it set in?')).toBeVisible();
	await page.getByRole('button', { name: 'Skip these questions' }).click();
	await expect(page.getByText('Which era is it set in?')).toHaveCount(0);
});
