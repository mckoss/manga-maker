import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const TEXT_LANE = 'Writing (text model)';
const IMAGE_LANE = 'Drawing (image model)';

/** A new series with a logline on chapter 1, left on its Plot page; returns that page's path. */
async function newChapterPlot(page: Page, title: string) {
	await page.goto('/series/new');
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Create series' }).click();
	const steps = page.getByRole('navigation', { name: 'Steps' });
	await steps.getByRole('link', { name: 'Chapter 1' }).click();
	await steps.getByRole('link', { name: 'Plot' }).click();
	await expect(page.getByRole('heading', { name: 'Plot', level: 1 })).toBeVisible();
	const logline = page.locator('#idea').getByLabel('Logline');
	await logline.fill('Aiko must deliver a letter before the storm.');
	await logline.blur();
	await expect(page.locator('#idea').getByText('Saved')).toBeVisible();
	return new URL(page.url()).pathname;
}

test('the queue lists both lanes and what finished', async ({ signedIn: page }) => {
	await page
		.locator('header')
		.getByRole('link', { name: /^Queue/ })
		.click();
	await expect(page.getByRole('heading', { name: 'Queue', level: 1 })).toBeVisible();
	await expect(page.locator('header').getByRole('link', { name: /^Queue/ })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.getByRole('region', { name: TEXT_LANE })).toBeVisible();
	await expect(page.getByRole('region', { name: IMAGE_LANE })).toBeVisible();

	const plot = await newChapterPlot(page, 'Signal Pass');
	await page.getByRole('button', { name: 'Generate everything' }).click();
	await expect(page.locator('#review').getByText('The climax relies on luck')).toBeVisible();

	await page
		.locator('header')
		.getByRole('link', { name: /^Queue/ })
		.click();
	const done = page
		.getByRole('region', { name: 'Recent' })
		.getByRole('listitem', { name: 'Done: Plot structure' })
		.filter({ has: page.locator(`a[href="${plot}"]`) });
	await expect(done).toHaveCount(1);
	await expect(done.getByText(/ago|just now/)).toBeVisible();
	await done.locator(`a[href="${plot}"]`).click();
	await expect(page.getByRole('heading', { name: 'Plot', level: 1 })).toBeVisible();
});

test.describe('with the text lane paused', () => {
	test.afterEach(async ({ page }) => {
		// Leave the lane running for the other specs, whatever happened.
		await page.goto('/queue');
		const lane = page.getByRole('region', { name: TEXT_LANE });
		const resume = lane.getByRole('button', { name: 'Resume lane' });
		if (await resume.isVisible()) {
			await resume.click();
			await expect(lane.getByRole('button', { name: 'Pause lane' })).toBeVisible();
		}
	});

	test('an admin pauses a lane; a waiting job is paused, resumed and stopped', async ({
		signedIn: page
	}) => {
		await page.goto('/queue');
		const lane = page.getByRole('region', { name: TEXT_LANE });
		await lane.getByRole('button', { name: 'Pause lane' }).click();
		await expect(lane.getByText('Paused', { exact: true })).toBeVisible();

		const plot = await newChapterPlot(page, 'Held Pass');
		await page.getByRole('button', { name: 'Generate everything' }).click();
		await page.goto('/queue');
		await expect(
			page.locator('header').getByRole('link', { name: /^Queue, \d+ active/ })
		).toBeVisible();

		const job = lane
			.getByRole('listitem', { name: /Plot structure$/ })
			.filter({ has: page.locator(`a[href="${plot}"]`) });
		await expect(job.getByText('Waiting', { exact: true })).toBeVisible();

		await job.getByRole('button', { name: /^Pause job/ }).click();
		await expect(job.getByText('Paused', { exact: true })).toBeVisible();
		await job.getByRole('button', { name: /^Resume job/ }).click();
		await expect(job.getByText('Waiting', { exact: true })).toBeVisible();

		await job.getByRole('button', { name: /^Stop job/ }).click();
		await expect(job).toHaveCount(0);
		await expect(
			page
				.getByRole('region', { name: 'Recent' })
				.getByRole('listitem', { name: 'Stopped: Plot structure' })
				.filter({ has: page.locator(`a[href="${plot}"]`) })
		).toHaveCount(1);

		// Resumed, the lane runs again: a new request goes through.
		await lane.getByRole('button', { name: 'Resume lane' }).click();
		await expect(lane.getByRole('button', { name: 'Pause lane' })).toBeVisible();
		await page.goto(plot);
		await page.getByRole('button', { name: 'Generate everything' }).click();
		await expect(page.locator('#review').getByText('The climax relies on luck')).toBeVisible();
	});
});
