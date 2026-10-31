<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import PictureCard from './PictureCard.svelte';
	import QuestionsCard from './QuestionsCard.svelte';
	import TextItemCard from './TextItemCard.svelte';

	type Editor = NonNullable<PageData['editor']>;
	let {
		ed,
		colorModes,
		models,
		form
	}: {
		ed: Editor;
		colorModes: PageData['colorModes'];
		models: PageData['models'];
		form: { error?: string; message?: string } | null;
	} = $props();

	// While AI jobs run, reload the page data every two seconds to show progress.
	$effect(() => {
		if (!ed.busy) return;
		const timer = setInterval(() => invalidateAll(), 2000);
		return () => clearInterval(timer);
	});

	const id = $derived(page.params.id ?? '');
	const outdated = (items: { item: Editor['prompt'] }[]) =>
		items.filter(({ item }) => {
			const current = item.versions.find((v) => v.id === item.currentId);
			return !item.locked && (!current || current.outOfDate.length > 0);
		}).length;
	let scenesToWrite = $derived(outdated(ed.scenes));
	let picturesToDraw = $derived(outdated(ed.pictures));
</script>

<div class="title-row">
	<h1>Style</h1>
	{#if ed.ready}
		<span class="badge">ready</span>
	{:else}
		<span class="badge muted">no sample picture yet</span>
	{/if}
</div>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.message}<p class="ok">{form.message}</p>{/if}

<ol class="pipeline" aria-label="How the style is made">
	<li>Your description</li>
	<li>Style prompt</li>
	<li>Sample scenes</li>
	<li>Sample pictures</li>
</ol>
<p class="hint">
	Each step is made from the ones before it. When an earlier step changes, what was made from it is
	marked <span class="badge warn">Out of date</span>. Every version is kept: browse back with ‹ ›,
	go back to one, and keep what you're happy with so it is never regenerated.
	{#if ed.ready}
		The rest of the series is drawn with the current prompt.
		<a href={resolve('/series/[id]/characters', { id })}>Next: characters →</a>
	{/if}
</p>

<section>
	<h2>1. Your description</h2>
	<TextItemCard
		item={ed.description}
		label="Description"
		kind="description"
		lines={3}
		placeholder="Gritty 90s seinen like a detective story: heavy blacks, rough cross-hatching, rain and neon."
	/>
	<QuestionsCard questions={ed.questions} />
	<TextItemCard
		item={ed.avoid}
		label="Keep out of every image"
		kind="avoid"
		placeholder="modern clothing, electric wires, cars"
	/>
	<p class="hint">
		The image models can't take a "don't draw" list, so the AI writes the prompt and scenes to show
		something else in its place.
	</p>
	<form method="POST" action="?/saveSettings" class="row settings" use:enhance>
		<label>
			Color
			<select name="colorMode">
				{#each colorModes as mode (mode.value)}
					<option value={mode.value} selected={ed.style.colorMode === mode.value}
						>{mode.label}</option
					>
				{/each}
			</select>
		</label>
		<label>
			Image model
			<select name="model">
				{#each models as model (model.value)}
					<option value={model.value} selected={ed.style.model === model.value}
						>{model.label}</option
					>
				{/each}
			</select>
		</label>
		<button type="submit" class="secondary small">Save color and model</button>
	</form>
</section>

<section>
	<h2>2. Style prompt</h2>
	<p class="hint">
		How everything is drawn, written by the AI from your description, color mode and keep-out list.
	</p>
	<TextItemCard
		item={ed.prompt}
		label="Style prompt"
		kind="prompt"
		lines={4}
		notesBy="AI art director"
		regenerate={{
			action: 'writePrompt',
			label: 'Rewrite the prompt',
			placeholder: 'Thicker outlines, fewer screentones, softer faces…'
		}}
	/>
</section>

<section>
	<h2>3. Sample scenes</h2>
	<p class="hint">
		What each test picture shows, written by the AI to fit your description's setting and era.
	</p>
	<form method="POST" action="?/writeScenes" class="stage" use:enhance>
		<label>
			Guidance for the AI (optional)
			<input name="guidance" placeholder="Set them all in winter…" />
		</label>
		<div class="row">
			<button type="submit" name="which" value="outdated" disabled={!scenesToWrite}
				>Write missing and out-of-date scenes{scenesToWrite ? ` (${scenesToWrite})` : ''}</button
			>
			<button type="submit" name="which" value="all" class="secondary"
				>Rewrite all scenes not kept</button
			>
		</div>
	</form>
	{#each ed.scenes as scene (scene.key)}
		<TextItemCard
			item={scene.item}
			label={scene.label}
			kind="scene"
			key={scene.key}
			regenerate={{
				action: 'writeScenes',
				which: scene.key,
				label: `Rewrite the ${scene.label.toLowerCase()} scene`,
				placeholder: 'A fishing village instead of a farm…'
			}}
		/>
	{/each}
</section>

<section>
	<h2>4. Sample pictures</h2>
	<p class="hint">
		The style prompt and each scene, drawn by the image model. About 5–10 seconds per picture. A
		redraw keeps the picture's seed unless you change it, so differences come from the prompt.
	</p>
	<form method="POST" action="?/drawPictures" class="row stage" use:enhance>
		<button type="submit" name="which" value="outdated" disabled={!picturesToDraw}
			>Draw missing and out-of-date pictures{picturesToDraw ? ` (${picturesToDraw})` : ''}</button
		>
		<button type="submit" name="which" value="all" class="secondary"
			>Redraw all pictures not kept</button
		>
	</form>
	<div class="samples">
		{#each ed.pictures as picture (picture.key)}
			<PictureCard item={picture.item} label={picture.label} subject={picture.key} />
		{/each}
	</div>
</section>

<section class="danger-zone">
	<form
		method="POST"
		action="?/startOver"
		use:enhance
		onsubmit={(e) => {
			if (!confirm('Throw away this style, with every version of everything, and start again?'))
				e.preventDefault();
		}}
	>
		<button type="submit" class="danger">Start the style over</button>
	</form>
</section>

<style>
	.pipeline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0;
		list-style: none;
		padding: 0;
		margin: 0.5rem 0;
		font-size: 0.85rem;
	}
	.pipeline li:not(:last-child)::after {
		content: '→';
		margin: 0 0.5rem;
		color: var(--muted);
	}
	section :global(.card) {
		margin-bottom: 0.75rem;
	}
	.settings {
		align-items: end;
	}
	.stage {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.stage.row {
		display: flex;
	}
	.samples {
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		align-items: start;
	}
</style>
