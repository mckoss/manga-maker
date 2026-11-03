<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import PictureCard from './PictureCard.svelte';
	import QuestionsCard from './QuestionsCard.svelte';
	import { batchLabel, pendingWork } from '#lib/components/batch.js';
	import LogoCard from './LogoCard.svelte';
	import TextItemCard from '#lib/components/TextItemCard.svelte';

	type Editor = NonNullable<PageData['editor']>;
	let {
		ed,
		logo,
		logline,
		colorModes,
		form
	}: {
		ed: Editor;
		logo: PageData['logo'];
		logline: string;
		colorModes: PageData['colorModes'];
		form: { error?: string; message?: string } | null;
	} = $props();

	// While AI jobs run, reload the page data every two seconds to show progress.
	$effect(() => {
		if (!ed.busy && !logo?.item.pending) return;
		const timer = setInterval(() => invalidateAll(), 2000);
		return () => clearInterval(timer);
	});

	const id = $derived(page.params.id ?? '');
	let scenesLabel = $derived(batchLabel(pendingWork(ed.scenes.map((s) => s.item)), 'scene'));
	let picturesLabel = $derived(batchLabel(pendingWork(ed.pictures.map((p) => p.item)), 'picture'));
	/** An amendment for every scene, or every picture: offers regenerating all unlocked. */
	let scenesAmendment = $state('');
	let picturesAmendment = $state('');
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
	<li>Sample scenes and pictures</li>
	<li>Series logo</li>
</ol>
<p class="hint">
	Each step is made from the ones before it. When an earlier step changes, what was made from it is
	marked <span class="badge warn">Out of date</span>, with a Regenerate button. Every version is
	saved: browse back with ‹ ›, select one, and lock what you're happy with so it is never
	regenerated.
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
		<button type="submit" class="secondary small">Save color</button>
	</form>
	<p class="hint">
		Pictures are drawn with {page.data.imageModel.label}{page.data.imageModel.fromSeries
			? ', chosen for this series'
			: ', your default'}. Change it in the
		<a href={resolve('/series/[id]', { id: String(page.data.series.id) })}>series settings</a>, or
		for one picture next to its Regenerate button.
	</p>
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
			placeholder: 'Thicker outlines, fewer screentones, softer faces…'
		}}
	/>
</section>

<section>
	<h2>3. Sample scenes and pictures</h2>
	<p class="hint">
		Each test picture is drawn from its scene, written by the AI to fit your description's setting
		and era, together with the style prompt. About 5–10 seconds per picture. Regenerating keeps the
		picture's seed unless you change it, so differences come from the words.
	</p>
	<form method="POST" action="?/writeScenes" class="row stage" use:enhance>
		<input
			name="guidance"
			class="amend"
			bind:value={scenesAmendment}
			placeholder="Amend every scene: set them all in winter"
			aria-label="Amendment for every scene"
		/>
		{#if scenesLabel}
			<button type="submit" name="which" value="outdated">{scenesLabel}</button>
		{/if}
		{#if scenesAmendment.trim()}
			<button type="submit" name="which" value="all" class="secondary"
				>Regenerate all unlocked scenes</button
			>
		{/if}
	</form>
	<form method="POST" action="?/drawPictures" class="row stage" use:enhance>
		<input
			name="guidance"
			class="amend"
			bind:value={picturesAmendment}
			placeholder="Amend every picture: lower camera angle"
			aria-label="Amendment for every picture"
		/>
		{#if picturesLabel}
			<button type="submit" name="which" value="outdated">{picturesLabel}</button>
		{/if}
		{#if picturesAmendment.trim()}
			<button type="submit" name="which" value="all" class="secondary"
				>Regenerate all unlocked pictures</button
			>
		{/if}
	</form>
	{#each ed.scenes as scene, i (scene.key)}
		{@const picture = ed.pictures[i]}
		<div class="pair">
			<TextItemCard
				item={scene.item}
				label="{scene.label} scene"
				kind="scene"
				key={scene.key}
				regenerate={{
					action: 'writeScenes',
					which: scene.key,
					placeholder: 'A fishing village instead of a farm…'
				}}
			/>
			<div class="samples">
				<PictureCard item={picture.item} label={picture.label} subject={picture.key} />
			</div>
		</div>
	{/each}
</section>

<section>
	<h2>4. Series logo</h2>
	{#if logo}<LogoCard {logo} seriesId={id} {logline} />{/if}
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
		color: var(--ink);
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
	.amend {
		flex: 1 1 18rem;
		min-width: 0;
	}
	/* A scene, and to its right the picture drawn from it. */
	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 13rem;
		gap: var(--gutter);
		align-items: start;
		margin-bottom: var(--gutter-wide);
	}
	.pair .samples {
		display: block;
		min-width: 0;
		margin: 0;
	}
	/* One box per scene: the scene's own card frame gives way to it. */
	.pair {
		padding: var(--space-4) var(--space-5);
		background: var(--surface-panel);
		border: var(--border-panel);
	}
	.pair :global(.card) {
		margin: 0;
		padding: 0;
		border: none;
	}
	@media (max-width: 720px) {
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
