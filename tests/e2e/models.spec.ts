import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const picture = (page: Page, label: string) =>
	page.locator('.picture').filter({ has: page.getByText(label, { exact: true }) });

test('chooses the image model: the user’s default, the series’, and one picture’s', async ({
	signedIn: page
}) => {
	// The user's default.
	await page.goto('/account');
	await page.getByRole('combobox', { name: 'Image model', exact: true }).selectOption('z-image');
	await page.getByRole('button', { name: 'Save' }).first().click();
	await expect(page.getByText('Default image model saved.')).toBeVisible();

	await page.goto('/series/new');
	await page.getByLabel('Title').fill('Models');
	await page.getByRole('button', { name: 'Create series' }).click();
	await expect(page.getByText('Drawn with Z-Image Turbo')).toBeVisible();
	await page.getByLabel('Describe the look').fill('Edo-period ink');
	await page.getByRole('button', { name: 'Start the style' }).click();
	await page.getByRole('button', { name: 'Generate 5 pictures' }).click();
	const face = picture(page, 'Face');
	// Each version says which model drew it (the fake backend's name for it).
	await expect(face.getByText('fake:z-image')).toBeVisible();

	// One picture, redrawn with another model.
	await face.getByLabel('Image model for Face').selectOption('qwen-image-2.1');
	await face.getByRole('button', { name: 'Regenerate Face' }).click();
	await expect(face.getByText('2 of 2')).toBeVisible();
	await expect(face.getByText('fake:qwen-image-2.1')).toBeVisible();

	// The series' own choice, in its settings.
	const style = page.url();
	await page.goto(style.replace(/\/style$/, ''));
	await page.getByRole('combobox', { name: 'Image model', exact: true }).selectOption('qwen-image');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await page
		.getByRole('navigation', { name: 'Steps' })
		.getByRole('link', { name: 'Style' })
		.click();
	await expect(page.getByText(/drawn with Qwen-Image 2512, chosen for this series/)).toBeVisible();
	await expect(face.getByLabel('Image model for Face')).toContainText('Qwen-Image 2512 (series)');
});
