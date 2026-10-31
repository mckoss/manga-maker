import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const SERIES_STEPS = ['Style', 'Characters', 'Locations'];
const CHAPTER_STEPS = ['Cast', 'Plot', 'Script', 'Panels', 'Pages'];

async function newSeries(page: Page, title: string) {
	await page.goto('/');
	await page.getByRole('link', { name: 'New series' }).first().click();
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Create series' }).click();
	await expect(page.getByRole('heading', { name: 'Style', level: 1 })).toBeVisible();
}

/** Start a style; the (fake) AI writes the prompt and scenes, then draw the samples. */
async function readyStyle(page: Page) {
	await page.getByLabel('Describe the look').fill('Edo-period ink, villages, kimono');
	await page.getByRole('button', { name: 'Start the style' }).click();
	await expect(page.getByRole('textbox', { name: 'Style prompt', exact: true })).not.toHaveValue(
		''
	);
	await page.getByRole('button', { name: /Draw missing and out-of-date pictures/ }).click();
	await expect(page.getByRole('img', { name: 'Action sample' })).toBeVisible();
	await expect(page.getByText('ready', { exact: true }).first()).toBeVisible();
}

test('creates a series with a first chapter and walks their steps', async ({ signedIn: page }) => {
	await newSeries(page, 'Ronin Road');
	const steps = page.getByRole('navigation', { name: 'Steps' });
	for (const step of SERIES_STEPS) {
		await expect(steps.getByRole('link', { name: step })).toBeVisible();
	}
	await expect(steps.getByText('not started')).toBeVisible();
	await steps.getByRole('link', { name: 'Locations' }).click();
	await expect(page.getByText('Not built yet.')).toBeVisible();

	await steps.getByRole('link', { name: 'Chapter 1' }).click();
	await expect(page.getByRole('heading', { name: 'Chapter 1', level: 1 })).toBeVisible();
	for (const step of CHAPTER_STEPS) {
		await expect(steps.getByRole('link', { name: step })).toBeVisible();
	}
	for (const step of CHAPTER_STEPS.slice(1)) {
		await steps.getByRole('link', { name: step }).click();
		await expect(page.getByRole('heading', { name: step, level: 1 })).toBeVisible();
		await expect(page.getByText('Not built yet.')).toBeVisible();
	}

	await steps.getByRole('link', { name: 'Ronin Road' }).click();
	await page.getByLabel('Logline', { exact: true }).fill('A swordsman walks home.');
	await page.getByLabel('Left to right').check();
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Left to right')).toBeChecked();
});

test('makes a style ready and shows it as the cover', async ({ signedIn: page }) => {
	await newSeries(page, 'Cover Test');
	await readyStyle(page);
	await expect(page.getByRole('navigation', { name: 'Steps' }).getByText('ready')).toBeVisible();

	await page.getByRole('link', { name: 'My manga' }).click();
	const card = page.getByRole('link', { name: /Cover Test/ });
	await expect(card.getByText('Style ready')).toBeVisible();
	await expect(card.locator('img')).toHaveJSProperty('complete', true);
});

test("reuses another series' style", async ({ signedIn: page }) => {
	await newSeries(page, 'Original');
	await readyStyle(page);
	await newSeries(page, 'Sequel');
	await page
		.getByRole('listitem')
		.filter({ hasText: 'Original' })
		.getByRole('button', { name: 'Use this style' })
		.click();
	await expect(page.getByText('Style copied.')).toBeVisible();
	await expect(page.getByRole('img', { name: 'Figure sample' })).toBeVisible();
});

test('deletes a series', async ({ signedIn: page }) => {
	await newSeries(page, 'Doomed');
	await page
		.getByRole('navigation', { name: 'Steps' })
		.getByRole('link', { name: 'Doomed' })
		.click();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete this series' }).click();
	await expect(page.getByRole('heading', { name: 'My manga' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Doomed/ })).toHaveCount(0);
});

test('adds chapters, picks their casts, and keeps each on its design', async ({
	signedIn: page
}) => {
	await newSeries(page, 'Two Chapters');
	await readyStyle(page);
	const steps = page.getByRole('navigation', { name: 'Steps' });

	// A character made in chapter 1 joins it, and the series.
	await steps.getByRole('link', { name: 'Chapter 1' }).click();
	await steps.getByRole('link', { name: 'Cast' }).click();
	await expect(page.getByText('Nobody yet.')).toBeVisible();
	await page.getByLabel('Describe them').fill('a runaway girl with a staff');
	await page.getByRole('button', { name: 'Add character' }).click();
	await expect(page.getByRole('heading', { name: 'Aiko', level: 1 })).toBeVisible();
	await page.getByRole('button', { name: 'Draw all 4 designs' }).click();
	const options = page.getByRole('button', { name: 'Use as reference' });
	await expect(options).toHaveCount(4);
	await options.nth(0).click();
	await expect(page.getByText('Reference picture chosen.')).toBeVisible();

	// Chapter 2 starts empty; Aiko is picked from the series.
	await steps.getByRole('link', { name: 'Two Chapters' }).click();
	await page.getByText('Add a chapter').click();
	await page.getByLabel('Title (optional)').fill('The Pass');
	await page.getByRole('button', { name: 'Add chapter' }).click();
	await expect(page.getByRole('heading', { name: 'Cast', level: 1 })).toBeVisible();
	await page.getByRole('button', { name: 'Add Aiko to the chapter' }).click();
	await expect(page.getByRole('img', { name: 'Aiko design' })).toBeVisible();

	// A redesign shows as newer in both chapters until each moves to it.
	await page.getByRole('link', { name: 'Aiko' }).click();
	await page.getByRole('button', { name: 'Use as reference' }).first().click();
	await expect(page.getByText('Reference picture chosen.')).toBeVisible();
	await steps.getByRole('link', { name: 'Chapter 1' }).click();
	await steps.getByRole('link', { name: 'Cast' }).click();
	await expect(page.getByText('Newer design', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Use the newer design' }).click();
	await expect(page.getByText('Newer design', { exact: true })).toHaveCount(0);
	await steps.getByRole('link', { name: 'The Pass' }).click();
	await steps.getByRole('link', { name: 'Cast' }).click();
	await expect(page.getByText('Newer design', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Remove Aiko from the chapter' }).click();
	await expect(page.getByRole('button', { name: 'Add Aiko to the chapter' })).toBeVisible();
});

test('sends old manga links to the series', async ({ signedIn: page }) => {
	await newSeries(page, 'Old Links');
	const id = page.url().match(/series\/(\d+)/)![1];
	await page.goto(`/manga/${id}/characters`);
	await expect(page).toHaveURL(`/series/${id}/characters`);
	await page.goto(`/manga/${id}/plot`);
	await expect(page).toHaveURL(`/series/${id}`);
});
