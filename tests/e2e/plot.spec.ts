import { expect, test } from './fixtures';

test('plots a chapter: structure, story elements, beats with their cast, and a review', async ({
	signedIn: page
}) => {
	await page.goto('/series/new');
	await page.getByLabel('Title').fill('Storm Pass');
	await page.getByRole('button', { name: 'Create series' }).click();
	const steps = page.getByRole('navigation', { name: 'Steps' });
	await steps.getByRole('link', { name: 'Chapter 1' }).click();
	await steps.getByRole('link', { name: 'Plot' }).click();
	await expect(page.getByRole('heading', { name: 'Plot', level: 1 })).toBeVisible();

	// The idea: the logline saves when the user leaves the box.
	const logline = page.locator('#idea').getByLabel('Logline');
	await logline.fill('Aiko must deliver a letter before the storm.');
	await logline.blur();
	await expect(page.locator('#idea').getByText('Saved')).toBeVisible();

	// Nothing made yet: the pipeline button only generates.
	const everything = page.getByRole('button', { name: 'Generate everything' });
	await expect(everything).toBeEnabled();
	await everything.click();
	const serial = page.getByRole('listitem', { name: 'Serial chapter' });
	await expect(serial.getByText('In use')).toBeVisible();
	await expect(page.getByText('a serial chapter ends on a hook')).toBeVisible();
	await expect(page.locator('#elements').getByLabel('Climax', { exact: true })).toHaveValue(
		/bridge/
	);
	const beats = page.locator('#beats article');
	await expect(beats).toHaveCount(5);
	await expect(page.locator('#review').getByText('The climax relies on luck')).toBeVisible();

	// The first beat names someone new: they join the series and the chapter's cast.
	await expect(beats.first().getByLabel('Old Watchman')).toBeChecked();
	await expect(page.locator('#beats').getByText('cast: Old Watchman')).toBeVisible();

	// Switching structure marks the elements out of date and lays out its beats.
	await page.getByRole('button', { name: 'Use Kishōtenketsu (起承転結)' }).click();
	await expect(page.getByText('Structure chosen.')).toBeVisible();
	await expect(beats).toHaveCount(4);
	await expect(
		page.getByRole('navigation', { name: 'How the plot is made' }).getByText('9 to update')
	).toBeVisible();

	// The new character waits on the Characters page with what is left to do.
	await steps.getByRole('link', { name: 'Characters' }).click();
	const todo = page.getByRole('list', { name: 'To do for Old Watchman' });
	await expect(todo.getByText('Profile')).toBeVisible();
});
