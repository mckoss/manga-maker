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

test('builds a location through its pipeline, chooses a reference, and draws its sheet', async ({
	signedIn: page
}) => {
	await newSeries(page, 'Places Test');
	await readyStyle(page);
	await steps(page).getByRole('link', { name: 'Locations' }).click();
	await expect(page.getByRole('heading', { name: 'Locations', level: 1 })).toBeVisible();

	await page.getByLabel('Describe it').fill('the inn where the travelers meet');
	await page.getByRole('button', { name: 'Add location' }).click();

	// The (fake) AI writes the profile, including a name, then the designs.
	await expect(page.getByRole('heading', { name: 'The Lantern Inn', level: 1 })).toBeVisible();
	await expect(page.getByText('AI location scout:')).toBeVisible();
	await expect(page.locator('#profile').getByLabel('What and where', { exact: true })).toHaveValue(
		/mountain pass/
	);
	// The first location is the series' default.
	await expect(page.getByText('Default location for series')).toBeVisible();

	await page.getByRole('button', { name: 'Generate 4 pictures' }).click();
	const options = page.getByRole('button', { name: /^Use design \d as reference$/ });
	await expect(options).toHaveCount(4);
	await options.nth(2).click();
	await expect(page.getByText('Reference picture chosen.')).toBeVisible();
	await expect(page.locator('#designs .design.reference .banner')).toHaveText('Chosen reference');

	await page.getByRole('button', { name: 'Generate the location sheet' }).click();
	await expect(page.getByRole('img', { name: /^The Lantern Inn: / })).toHaveCount(8);

	await page.getByRole('link', { name: '← Locations' }).click();
	await expect(
		page.getByRole('link', { name: /The Lantern Inn/ }).getByText('reference chosen')
	).toBeVisible();
	await expect(steps(page).getByText('1/1')).toBeVisible();
});

test('chooses the default location for the series', async ({ signedIn: page }) => {
	await newSeries(page, 'Default Place');
	await steps(page).getByRole('link', { name: 'Locations' }).click();
	for (const name of ['Harbor', 'Temple']) {
		await page.getByLabel('Name (optional)').fill(name);
		await page.getByRole('button', { name: 'Add location' }).click();
		await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
		await page.getByRole('link', { name: '← Locations' }).click();
	}
	const card = (name: string) => page.getByRole('listitem').filter({ hasText: name });
	await expect(card('Harbor').getByText('Default location for series')).toBeVisible();
	await card('Temple')
		.getByRole('button', { name: 'Make Temple the default location for series' })
		.click();
	await expect(card('Temple').getByText('Default location for series')).toBeVisible();
	await expect(card('Harbor').getByRole('button', { name: /Make Harbor/ })).toBeVisible();

	// And from the location's own page.
	await card('Harbor').getByRole('link').click();
	await page.getByRole('button', { name: 'Make default location for series' }).click();
	await expect(page.getByText('This is now the default location for the series.')).toBeVisible();
	await expect(page.getByText('Default location for series', { exact: true })).toBeVisible();

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete location' }).click();
	await expect(page.getByRole('heading', { name: 'Locations', level: 1 })).toBeVisible();
	await expect(card('Temple').getByText('Default location for series')).toBeVisible();
});
