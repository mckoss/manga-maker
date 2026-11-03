<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TextItemCard from '#lib/components/TextItemCard.svelte';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import { outOfDateText } from '#lib/components/labels.js';
	import type { PageProps } from './$types';
	import DesignCard from './DesignCard.svelte';
	import FlowDiagram from './FlowDiagram.svelte';
	import SheetCell from './SheetCell.svelte';
	import { batchLabel, pendingWork } from '#lib/components/batch.js';

	let { data, form }: PageProps = $props();

	// While AI jobs run, reload the page data every two seconds to show progress.
	$effect(() => {
		if (!data.busy) return;
		const timer = setInterval(() => invalidateAll(), 2000);
		return () => clearInterval(timer);
	});

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
	let id = $derived(String(data.series.id));
	let loc = $derived(data.location);
	let name = $derived(loc.name || 'New location');
	let due = $derived(Object.values(data.due).reduce((a, b) => a + b, 0));

	let refItem = $derived(data.reference.item);
	let refViewId = $state<number | null>(null);
	let refCurrent = $derived(refItem.versions.find((v) => v.id === refItem.currentId));
	let refShown = $derived(refItem.versions.find((v) => v.id === refViewId) ?? refCurrent);
	let refLabel = $derived.by(() => {
		try {
			return (JSON.parse(refShown?.text ?? '') as { label?: string }).label ?? '';
		} catch {
			return '';
		}
	});
	/** Each design's selected picture: the options for the reference. */
	let options = $derived(
		data.designs.flatMap((d) => {
			const v = d.picture.versions.find((p) => p.id === d.picture.currentId);
			if (!v?.assetHash || !v.thumbHash) return [];
			let label = '';
			try {
				const words = d.design.versions.find((x) => x.id === d.design.currentId)?.text;
				label = (JSON.parse(words ?? '') as { label?: string }).label ?? '';
			} catch {
				// Unreadable words: fall back to the slot name.
			}
			return [{ key: d.key, version: v, label: label || `Design ${d.key}` }];
		})
	);
	let hasDesign = $derived(data.designs.some((d) => d.design.currentId !== null));
	/** No design picture has been drawn yet: the first drawing is the only next step. */
	let neverDrawn = $derived(data.designs.every((d) => d.picture.versions.length === 0));
	/** Amendments for regenerating every unlocked artifact of a step. */
	let profileAmendment = $state('');
	let designsAmendment = $state('');
	let sheetAmendment = $state('');
	let canWrite = $derived(
		data.hasStyle && data.profile.some((p) => p.kind === 'appearance' && p.item.currentId !== null)
	);
</script>

<svelte:head><title>{name} · {data.series.title} · Manga Maker</title></svelte:head>

<p><a href={resolve('/series/[id]/locations', { id })}>← Locations</a></p>

<div class="title-row">
	<h1>{name}</h1>
	{#if refCurrent}
		<span class="badge">reference chosen</span>
	{:else}
		<span class="badge muted">designing</span>
	{/if}
	{#if data.isDefault}
		<span class="badge shu">Default location for series</span>
	{:else}
		<form method="POST" action="?/makeDefault" use:enhance>
			<button type="submit" class="secondary small">Make default location for series</button>
		</form>
	{/if}
</div>
<p class="hint">
	The default location is where the series logo is set, and where a scene goes when the script names
	no other place. The first location you make is the default until you choose another.
</p>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.message}<p class="ok" role="status">{form.message}</p>{/if}

<FlowDiagram flow={data.flow} {due} />
<p class="hint">
	Each step is made from the ones before it. When something changes, what was made from it is marked <span
		class="badge warn">Out of date</span
	>, and what comes after shows
	<span class="badge muted">Earlier step changed</span>; nothing is regenerated until you ask. Every
	text and picture keeps its versions: browse back with ‹ › and select one. Lock what you're happy
	with and it is never regenerated; what you write yourself is locked for you, and you can unlock
	it.
</p>

{#if data.developing}
	<p class="mentor"><span class="spinner"></span> The AI is writing the profile…</p>
{:else if data.notes}
	<p class="mentor"><strong>AI location scout:</strong> {data.notes}</p>
{/if}

<div class="layout">
	<div>
		<section id="notes">
			<h2>1. Your notes</h2>
			<TextItemCard
				item={data.brief}
				label="Your notes"
				kind="brief"
				lines={3}
				lockable={false}
				placeholder="The inn where the travelers meet, high in a mountain pass…"
			/>
		</section>

		<section id="profile">
			<h2>2. Profile</h2>
			<p class="hint">
				Written by the AI from your notes. The look fields (what and where, layout, details) are
				what the designs are made from.
			</p>
			<div class="row">
				{#if data.due.profile}
					<form method="POST" action="?/update" use:enhance>
						<input type="hidden" name="stage" value="profile" />
						<button type="submit"
							>{batchLabel(pendingWork(data.profile.map((p) => p.item)), 'field')}</button
						>
					</form>
				{/if}
				<form method="POST" action="?/rewriteProfile" class="row amend-all" use:enhance>
					<input
						name="guidance"
						bind:value={profileAmendment}
						placeholder="Amend every field: older, more run-down"
						aria-label="Amendment for every profile field"
					/>
					{#if profileAmendment.trim()}
						<button type="submit" class="secondary" disabled={data.developing}
							>Regenerate all unlocked fields</button
						>
					{/if}
				</form>
			</div>
			{#each data.profile as field (field.kind)}
				<TextItemCard
					item={field.item}
					label={field.label}
					kind={field.kind}
					status={field.status}
					lines={field.kind === 'appearance'
						? 3
						: field.kind === 'name' || field.kind === 'setting'
							? 1
							: 2}
					regenerate={{
						action: 'rewriteProfile',
						which: field.kind,
						placeholder: 'Shorter; more run-down; …'
					}}
				/>
			{/each}
		</section>
	</div>

	<aside class="pictures" id="reference">
		<h2>Reference picture</h2>
		{#if refShown?.assetHash && refShown.thumbHash}
			<a href={asset(refShown.assetHash)} target="_blank" rel="noopener">
				<img
					class="reference"
					src={asset(refShown.thumbHash)}
					alt="{name} reference"
					class:faded={refShown.id !== refItem.currentId}
				/>
			</a>
			{#if refLabel}<p class="variant">{refLabel}</p>{/if}
			{#if refShown.outOfDate.length}
				<p class="why">
					<span class="badge warn">Out of date</span>
					{outOfDateText(refShown.outOfDate)} Choose a newer design picture to update it.
				</p>
			{/if}
			<VersionNav
				item={refItem}
				shown={refShown}
				label="Reference"
				lockable={false}
				onview={(v) => (refViewId = v)}
			/>
		{:else}
			<p class="hint">
				Choose one of the design pictures. Every panel set here will draw the place from it.
			</p>
		{/if}
	</aside>
</div>

<section id="designs">
	<h2>3. Design variants and option pictures</h2>
	{#if !data.hasStyle}
		<p class="hint">
			Designs are written for the series' style:
			<a href={resolve('/series/[id]/style', { id })}>start the style</a> first.
		</p>
	{:else if !data.style}
		<p class="hint">
			Pictures are drawn in the series' style:
			<a href={resolve('/series/[id]/style', { id })}>draw a sample picture of the style</a> first.
		</p>
	{/if}
	<p class="hint">
		Four different takes on the place, written from the profile. Edit any design's words, then draw
		it; choose the picture you like as the reference.
	</p>
	{#if data.traits?.free.length}
		<details class="traits">
			<summary>What the designs vary</summary>
			<ul>
				{#each data.traits.free as trait, i (i)}<li>{trait}</li>{/each}
			</ul>
			{#if data.traits.fixed.length}
				<p class="hint">The same in every design:</p>
				<ul>
					{#each data.traits.fixed as trait, i (i)}<li>{trait}</li>{/each}
				</ul>
			{/if}
		</details>
	{/if}
	<div class="row">
		<!-- Only what can be done now: hidden, not disabled, when there is nothing to do. -->
		{#if data.due.designs}
			<form method="POST" action="?/update" use:enhance>
				<input type="hidden" name="stage" value="designs" />
				<button type="submit"
					>{batchLabel(pendingWork(data.designs.map((d) => d.design)), 'design')}</button
				>
			</form>
		{/if}
		{#if data.due.pictures}
			<form method="POST" action="?/update" use:enhance>
				<input type="hidden" name="stage" value="pictures" />
				<button type="submit"
					>{batchLabel(pendingWork(data.designs.map((d) => d.picture)), 'picture')}</button
				>
			</form>
		{/if}
		{#if (!data.due.designs && data.flow.designs.stale) || (!data.due.pictures && data.flow.pictures.stale)}
			<span class="hint waiting">
				Out-of-date steps wait for the ones before them: update or keep the
				{!data.due.designs && data.flow.designs.stale ? 'profile' : 'designs'} first.
			</span>
		{/if}
		{#if !hasDesign}
			<form method="POST" action="?/writeDesigns" use:enhance>
				<button type="submit" disabled={!canWrite || data.designing}>Generate designs</button>
			</form>
		{:else if !neverDrawn}
			<form method="POST" action="?/writeDesigns" class="row amend-all" use:enhance>
				<input
					name="guidance"
					bind:value={designsAmendment}
					placeholder="Amend every design: in winter, at night"
					aria-label="Amendment for every design"
				/>
				{#if designsAmendment.trim()}
					<button type="submit" class="secondary" disabled={!canWrite || data.designing}
						>Regenerate all unlocked designs</button
					>
				{/if}
			</form>
		{/if}
	</div>
	<div class="designs">
		{#each data.designs as d (d.key)}
			<DesignCard
				slot={d.key}
				design={d.design}
				designStatus={d.designStatus}
				picture={d.picture}
				pictureStatus={d.pictureStatus}
				referenceHash={refCurrent?.assetHash ?? null}
				canDraw={Boolean(data.style)}
				{canWrite}
			/>
		{/each}
	</div>
</section>

<section id="sheet">
	<h2>4. Location sheet</h2>
	<p class="hint">
		The reference picture redrawn from other angles and at other times of day, so panels can set a
		scene here any way the script needs. About 10 seconds per picture.
	</p>
	{#if options.length}
		<div class="choices" role="group" aria-label="Reference options">
			{#each options as o (o.key)}
				{@const chosen = o.version.assetHash === refCurrent?.assetHash}
				<div class="choice" class:chosen>
					<div class="frame">
						<img src={asset(o.version.thumbHash ?? '')} alt="{o.label} option" loading="lazy" />
						{#if chosen}<p class="banner">Chosen reference</p>{/if}
					</div>
					<span class="label">{o.label}</span>
					{#if !chosen}
						<form method="POST" action="?/choose" use:enhance>
							<input type="hidden" name="versionId" value={o.version.id} />
							<button
								type="submit"
								class="secondary small"
								aria-label="Choose {o.label} as reference">Choose</button
							>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if !refCurrent}
		<p class="hint">
			{options.length
				? 'Choose one of these design pictures as the reference.'
				: 'Draw the design pictures above, then choose one as the reference.'}
		</p>
	{:else}
		<div class="row">
			{#if data.due.sheet && data.sheet.some((s) => s.item.currentId)}
				<form method="POST" action="?/update" use:enhance>
					<input type="hidden" name="stage" value="sheet" />
					<button type="submit"
						>{batchLabel(pendingWork(data.sheet.map((s) => s.item)), 'view')}</button
					>
				</form>
			{/if}
			{#if !data.due.sheet && data.flow.sheet.stale}
				<span class="hint waiting">Choose an up-to-date reference picture first.</span>
			{/if}
			{#if data.sheet.some((s) => s.item.pending)}
				<form method="POST" action="?/stopSheet" use:enhance>
					<button type="submit" class="danger">Stop generating</button>
				</form>
			{/if}
			{#if data.sheet.every((s) => !s.item.currentId)}
				<form method="POST" action="?/sheet" use:enhance>
					<button type="submit" disabled={!data.style}>Generate the location sheet</button>
				</form>
			{:else}
				<form method="POST" action="?/sheet" class="row amend-all" use:enhance>
					<input
						name="guidance"
						bind:value={sheetAmendment}
						placeholder="Amend every view: in winter"
						aria-label="Amendment for every view"
					/>
					{#if sheetAmendment.trim()}
						<button type="submit" class="secondary" disabled={!data.style}
							>Regenerate all unlocked views</button
						>
					{/if}
				</form>
			{/if}
		</div>
		<div class="sheet">
			{#each data.sheet as cell (cell.view)}
				<SheetCell
					view={cell.view}
					label={cell.label}
					{name}
					item={cell.item}
					status={cell.status}
					canDraw={Boolean(data.style)}
				/>
			{/each}
		</div>
	{/if}
</section>

<section class="danger-zone">
	<form
		method="POST"
		action="?/delete"
		onsubmit={(e) => {
			if (!confirm(`Delete ${loc.name || 'this location'}?`)) e.preventDefault();
		}}
	>
		<button type="submit" class="danger">Delete location</button>
	</form>
</section>

<style>
	.title-row form {
		margin: 0;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 20rem;
		gap: 1.5rem;
		align-items: start;
	}
	.pictures {
		position: sticky;
		top: 1rem;
	}
	/* Location pictures are 1344×768. */
	.reference {
		width: 100%;
		aspect-ratio: 7 / 4;
		object-fit: cover;
		border: var(--border-panel);
		box-sizing: border-box;
	}
	.faded {
		opacity: 0.5;
	}
	.variant {
		margin: 0.25rem 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.why {
		font-size: 0.85rem;
		color: var(--warn);
	}
	.designs {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--gutter);
		margin-top: 0.75rem;
	}
	.amend-all {
		flex: 1 1 22rem;
		margin: 0;
	}
	.amend-all input {
		flex: 1 1 14rem;
		min-width: 0;
	}
	/* The reference options at the top of the sheet: one thumbnail per design. */
	.choices {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: var(--space-4);
		max-width: 60rem;
		margin: var(--space-3) 0 var(--space-4);
	}
	.choice {
		display: grid;
		gap: var(--space-2);
		align-content: start;
		margin: 0;
	}
	.choice img {
		width: 100%;
		aspect-ratio: 7 / 4;
		object-fit: cover;
		border: var(--border-panel);
		box-sizing: border-box;
		opacity: 0.7;
	}
	.choice.chosen img {
		opacity: 1;
		border-color: var(--shu);
		outline: 3px solid var(--shu);
	}
	.choice .label {
		font: 700 13px var(--font-body);
	}
	.frame {
		position: relative;
	}
	.choice .banner {
		position: absolute;
		top: 3px;
		left: 3px;
		right: 3px;
		margin: 0;
		padding: 2px var(--space-2);
		background: var(--shu);
		color: var(--paper);
		font: 700 10px/1.4 var(--font-body);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		text-align: center;
		white-space: nowrap;
	}
	.sheet {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	.traits summary {
		cursor: pointer;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.row form {
		margin: 0;
	}
	.waiting {
		margin: 0;
		font-size: 0.85rem;
	}
	@media (max-width: 720px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.pictures {
			position: static;
		}
	}
</style>
