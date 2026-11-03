import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function newStyle(page: Page, title: string) {
	await page.goto('/series/new');
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Create series' }).click();
	await page.getByLabel('Describe the look').fill('Edo-period ink, villages, kimono');
	await page.getByRole('button', { name: 'Start the style' }).click();
	await page.getByRole('button', { name: 'Generate 5 pictures' }).click();
	await expect(page.getByRole('img', { name: 'Action sample' })).toBeVisible();
}

const picture = (page: Page, label: string) =>
	page.locator('.picture').filter({ has: page.getByText(label, { exact: true }) });

test('regenerates a picture on a new seed, selects an older version and locks it', async ({
	signedIn: page
}) => {
	await newStyle(page, 'Versions');
	const face = picture(page, 'Face');
	// Up to date: nothing to regenerate until the seed or the prompt changes.
	await expect(face.getByRole('button', { name: 'Regenerate Face' })).toHaveCount(0);
	await face.getByLabel('Seed for Face', { exact: true }).fill('12345');
	await face.getByLabel('Amendment for Face').fill('looking up at the sky');
	await face.getByRole('button', { name: 'Regenerate Face' }).click();
	await expect(face.getByText('2 of 2')).toBeVisible();
	await expect(face.getByText('Seed 12345')).toBeVisible();
	await expect(face.getByText('amended: looking up at the sky')).toBeVisible();

	await face.getByRole('button', { name: 'Older version of Face' }).click();
	await expect(face.getByText('1 of 2')).toBeVisible();
	await expect(face.getByText('not selected')).toBeVisible();
	await face.getByRole('button', { name: 'Select and lock' }).click();
	await expect(page.getByText('Selected that version, and locked it.')).toBeVisible();
	await expect(face.getByText('Locked', { exact: true })).toBeVisible();
	await expect(face.getByLabel('Amendment for Face')).toHaveCount(0);

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
	const description = page.getByRole('textbox', { name: 'Description', exact: true });
	await description.fill('Edo-period ink, fishing villages, winter');
	await description.blur();
	await expect(page.getByText('Made before the description changed.').first()).toBeVisible();

	// The out-of-date prompt offers Regenerate right by its badge, with an amendment.
	const prompt = page
		.locator('.item')
		.filter({ has: page.getByRole('textbox', { name: 'Style prompt', exact: true }) });
	await prompt.getByLabel('Amendment for Style prompt').fill('heavier blacks');
	await prompt.getByRole('button', { name: 'Regenerate Style prompt' }).click();
	await expect(prompt.getByText('2 of 2')).toBeVisible();
	await expect(prompt.getByText('amended: heavier blacks')).toBeVisible();
	await expect(
		picture(page, 'Figure').getByText('Made before the style prompt changed.')
	).toBeVisible();

	await page.getByRole('button', { name: 'Regenerate 5 out-of-date pictures' }).click();
	await expect(picture(page, 'Action').getByText('2 of 2')).toBeVisible();
	await expect(page.getByText('Made before the style prompt changed.')).toHaveCount(0);
	// Made with today's prompts: no note about an earlier version of the prompt.
	await expect(prompt.getByText('generated', { exact: false }).first()).toBeVisible();
	await expect(page.getByText('made with an earlier version of the prompt')).toHaveCount(0);
});

test('shows pictures made from a changed step as Earlier step changed, and redraws nothing', async ({
	signedIn: page
}) => {
	await newStyle(page, 'Upstream');
	const figure = picture(page, 'Figure');
	await expect(figure.getByText('Earlier step changed')).toHaveCount(0);
	const description = page.getByRole('textbox', { name: 'Description', exact: true });
	await description.fill('Edo-period ink, mountain passes, snow');
	await description.blur();
	await expect(page.getByText('Made before the description changed.').first()).toBeVisible();
	for (const label of ['Figure', 'Face', 'Interior', 'Exterior', 'Action']) {
		await expect(picture(page, label).getByText('Earlier step changed')).toBeVisible();
	}
	// Nothing is redrawn: each picture is still its first version, and none is generating.
	await page.reload();
	await expect(figure.getByText('Earlier step changed')).toBeVisible();
	await expect(page.locator('.picture').getByText('Generating…')).toHaveCount(0);
	await expect(page.locator('.picture').getByText('2 of 2')).toHaveCount(0);
	await expect(figure.getByRole('button', { name: 'Regenerate Figure' })).toHaveCount(0);
});

test('folds answers to the art director’s questions into the description', async ({
	signedIn: page
}) => {
	await newStyle(page, 'Questions');
	await expect(page.getByRole('group', { name: 'Which era is it set in?' })).toBeVisible();
	await page.getByRole('button', { name: 'The 1860s' }).click();
	await page
		.getByRole('textbox', { name: 'Answer: What kind of story is it?' })
		.fill('A quiet village drama');
	await page.getByRole('button', { name: 'Add my answers to the description' }).click();

	const description = page.getByRole('textbox', { name: 'Description', exact: true });
	await expect(description).toHaveValue(/The 1860s.*A quiet village drama/);
	await expect(page.getByRole('group', { name: 'Which era is it set in?' })).toHaveCount(0);
	await expect(page.getByText('Made before the description changed.').first()).toBeVisible();

	await page.getByRole('button', { name: "Ask the art director what's missing" }).click();
	await expect(page.getByRole('group', { name: 'Which era is it set in?' })).toBeVisible();
	await page.getByRole('button', { name: 'Skip these questions' }).click();
	await expect(page.getByRole('group', { name: 'Which era is it set in?' })).toHaveCount(0);
});
