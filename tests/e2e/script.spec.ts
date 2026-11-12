import { expect, test } from './fixtures';

test('scripts a chapter: pages, panels and words, flagged when a beat changes', async ({
	signedIn: page
}) => {
	await page.goto('/series/new');
	await page.getByLabel('Title').fill('Night Ferry');
	await page.getByRole('button', { name: 'Create series' }).click();
	const steps = page.getByRole('navigation', { name: 'Steps' });
	await steps.getByRole('link', { name: 'Chapter 1' }).click();

	// Before the plot is outlined, the script points there.
	await steps.getByRole('link', { name: 'Script' }).click();
	await expect(page.getByRole('heading', { name: 'Script', level: 1 })).toBeVisible();
	await expect(page.getByText('The script starts from the plot.')).toBeVisible();

	// Outline the plot: a serial chapter, five beats of four pages.
	await steps.getByRole('link', { name: 'Plot' }).click();
	const logline = page.locator('#idea').getByLabel('Logline');
	await logline.fill('Aiko must deliver a letter before the storm.');
	await logline.blur();
	await expect(page.locator('#idea').getByText('Saved')).toBeVisible();
	await page.getByRole('button', { name: 'Generate everything' }).click();
	await expect(page.locator('#beats article')).toHaveCount(5);
	await expect(page.locator('#review').getByText('The climax relies on luck')).toBeVisible();

	await steps.getByRole('link', { name: 'Script' }).click();
	const beats = page.getByRole('region', { name: /^Beat: / });
	await expect(beats).toHaveCount(5);
	await expect(beats.getByText('Planned: 4 pages')).toHaveCount(5);
	const hook = page.getByRole('region', { name: 'Beat: Hook' });
	await expect(hook.getByText('Laid out: 0')).toBeVisible();

	// A page, and what it is for.
	await hook.getByRole('button', { name: 'Add a page to Hook' }).click();
	const page1 = hook.getByRole('article', { name: 'Page 1' });
	await expect(page1).toBeVisible();
	await expect(hook.getByText('Laid out: 1')).toBeVisible();
	const purpose = page1.getByLabel('What this page is for');
	await purpose.fill('Aiko sees the storm coming.');
	await purpose.blur();
	await expect(page1.getByText('Saved')).toBeVisible();

	// A panel: shot, who, what we see.
	await page1.getByRole('button', { name: 'Add a panel to page 1' }).click();
	const panel1 = page1.getByRole('article', { name: 'Panel 1' });
	await expect(panel1).toBeVisible();
	const staging = panel1.locator('form.staging');
	await panel1.getByLabel('Shot').selectOption({ label: 'Wide' });
	await expect(staging.getByText('Saved')).toBeVisible();
	await panel1.getByLabel('Old Watchman').check();
	await expect(panel1.getByLabel('Old Watchman')).toBeChecked();
	await expect(staging.getByText('Saved')).toBeVisible();
	const action = panel1.getByLabel('What we see');
	await action.fill('The harbour under black clouds; the watchman points at the sea.');
	await action.blur();
	await expect(staging.getByText('Saved')).toBeVisible();

	// The words: a speech balloon with its speaker.
	const words = panel1.getByRole('form', { name: 'Words in Panel 1' });
	await words.getByRole('button', { name: '+ Speech' }).click();
	const balloon = words.getByRole('group', { name: 'Speech 1' });
	await expect(balloon.getByLabel('Text of Speech 1')).toHaveAttribute(
		'placeholder',
		'What do they say?'
	);
	await balloon.getByLabel('Speaker of Speech 1').selectOption({ label: 'Old Watchman' });
	const line = balloon.getByLabel('Text of Speech 1');
	await line.fill('No boat crosses tonight.');
	await line.blur();
	await expect(words.getByText('Saved')).toBeVisible();
	// Counted once the line is saved.
	await expect(page.getByText('1 balloon or caption')).toBeVisible();

	// Everything is still there after a reload.
	await page.reload();
	await expect(purpose).toHaveValue('Aiko sees the storm coming.');
	await expect(panel1.getByLabel('Shot')).toHaveValue('wide');
	await expect(panel1.getByLabel('Old Watchman')).toBeChecked();
	await expect(action).toHaveValue(/watchman points/);
	await expect(balloon.getByLabel('Speaker of Speech 1')).toHaveValue(/\d+/);
	await expect(line).toHaveValue('No boat crosses tonight.');

	// The key panel.
	const key = panel1.getByRole('button', { name: 'Key panel' });
	await expect(key).toHaveAttribute('aria-pressed', 'false');
	await key.click();
	await expect(key).toHaveAttribute('aria-pressed', 'true');

	// Editing the beat on the Plot page flags its pages; the writer checks them.
	await steps.getByRole('link', { name: 'Plot' }).click();
	const happens = page.locator('#beats article').first().getByLabel('What happens');
	await happens.fill('A storm rolls in over the harbour as Aiko arrives.');
	await happens.blur();
	await expect(page.locator('#beats article').first().getByText('Saved')).toBeVisible();

	await steps.getByRole('link', { name: 'Script' }).click();
	await expect(hook.getByText('A storm rolls in over the harbour')).toBeVisible();
	await expect(page1.getByText('Beat changed.')).toBeVisible();
	await page1.getByRole('button', { name: /checked it/ }).click();
	await expect(page1.getByText('Beat changed.')).toHaveCount(0);
});

test('the AI lays out a beat and fills blanks, never the words or what you wrote', async ({
	signedIn: page
}) => {
	await page.goto('/series/new');
	await page.getByLabel('Title').fill('Lantern Road');
	await page.getByRole('button', { name: 'Create series' }).click();
	const steps = page.getByRole('navigation', { name: 'Steps' });
	await steps.getByRole('link', { name: 'Chapter 1' }).click();
	await steps.getByRole('link', { name: 'Plot' }).click();
	const logline = page.locator('#idea').getByLabel('Logline');
	await logline.fill('Aiko must deliver a letter before the storm.');
	await logline.blur();
	await expect(page.locator('#idea').getByText('Saved')).toBeVisible();
	await page.getByRole('button', { name: 'Generate everything' }).click();
	await expect(page.locator('#review').getByText('The climax relies on luck')).toBeVisible();

	await steps.getByRole('link', { name: 'Script' }).click();
	const beat = page.getByRole('region', { name: 'Beat: Complication' });
	await beat.getByRole('button', { name: 'Help me lay out Complication' }).click();
	await expect(beat.getByText('Laid out: 4')).toBeVisible();
	// Staging is drafted and marked; the words are left to the writer, with a cue.
	const first = beat.getByRole('article', { name: 'Page 1' });
	await expect(first.getByRole('article', { name: /^Panel / })).toHaveCount(3);
	const panel1 = first.getByRole('article', { name: 'Panel 1' });
	await expect(panel1.getByLabel(/^What we see/)).toHaveValue(/Fake panel 1/);
	await expect(panel1.getByText('AI draft').first()).toBeVisible();
	await expect(
		first.getByRole('article', { name: 'Panel 2' }).getByText('Cue: What do they say here?')
	).toBeVisible();
	await expect(page.getByText('0 balloons and captions')).toBeVisible();
	// A beat with pages offers no layout help.
	await expect(beat.getByRole('button', { name: 'Help me lay out Complication' })).toHaveCount(0);

	// The writer rewrites one panel and adds a blank one; filling leaves theirs alone.
	const action = panel1.getByLabel(/^What we see/);
	await action.fill('Aiko pulls her hood up against the wind.');
	await action.blur();
	await expect(panel1.getByText('Saved')).toBeVisible();
	await first.getByRole('button', { name: 'Add a panel to page 1' }).click();
	const panel4 = first.getByRole('article', { name: 'Panel 4' });
	await expect(panel4.getByLabel(/^What we see/)).toHaveValue('');
	await first.getByRole('button', { name: 'Help me fill in page 1' }).click();
	await expect(panel4.getByLabel(/^What we see/)).toHaveValue(/Fake staging/);
	await expect(panel1.getByLabel(/^What we see/)).toHaveValue(
		'Aiko pulls her hood up against the wind.'
	);
	await expect(page.getByText('0 balloons and captions')).toBeVisible();
});
