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
	import RoleCard from './RoleCard.svelte';
	import SheetCell from './SheetCell.svelte';

	let { data, form }: PageProps = $props();

	// While AI jobs run, reload the page data every two seconds to show progress.
	$effect(() => {
		if (!data.busy) return;
		const timer = setInterval(() => invalidateAll(), 2000);
		return () => clearInterval(timer);
	});

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
	let id = $derived(String(data.series.id));
	let c = $derived(data.character);
	let name = $derived(c.name || 'New character');
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
	let hasDesign = $derived(data.designs.some((d) => d.design.currentId !== null));
	let canWrite = $derived(
		data.hasStyle && data.profile.some((p) => p.kind === 'appearance' && p.item.currentId !== null)
	);
</script>

<svelte:head><title>{name} · {data.series.title} · Manga Maker</title></svelte:head>

<p><a href={resolve('/series/[id]/characters', { id })}>← Characters</a></p>

<div class="title-row">
	<h1>{name}</h1>
	{#if refCurrent}
		<span class="badge">reference chosen</span>
	{:else}
		<span class="badge muted">designing</span>
	{/if}
</div>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.message}<p class="ok" role="status">{form.message}</p>{/if}

<FlowDiagram flow={data.flow} {due} />
<p class="hint">
	Each step is made from the ones before it. When something changes, what was made from it is marked <span
		class="badge warn">Out of date</span
	>, and what comes after shows
	<span class="badge muted">Earlier step changed</span>; nothing is regenerated until you ask. Every
	text and picture keeps its versions: browse back with ‹ ›. Keep what you're happy with and the AI
	won't touch it; what you write yourself is kept unless you untick the box.
</p>

{#if data.developing}
	<p class="mentor"><span class="spinner"></span> The AI is writing the profile…</p>
{:else if data.notes}
	<p class="mentor"><strong>AI story editor:</strong> {data.notes}</p>
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
				placeholder="A runaway girl with a staff, too proud to ask for help…"
			/>
			<RoleCard item={data.roleItem} role={data.role} roles={data.roles} />
		</section>

		<section id="profile">
			<h2>2. Profile</h2>
			<p class="hint">
				Written by the AI from your notes and the role. The look fields (age, appearance, outfit)
				are what the designs are made from.
			</p>
			<div class="row">
				<form method="POST" action="?/update" use:enhance>
					<input type="hidden" name="stage" value="profile" />
					<button type="submit" disabled={!data.due.profile}
						>Rewrite out-of-date fields{data.due.profile ? ` (${data.due.profile})` : ''}</button
					>
				</form>
			</div>
			<details class="card wide">
				<summary>Revise every field not kept…</summary>
				<form method="POST" action="?/rewriteProfile" use:enhance>
					<label>
						What should change?
						<textarea
							name="guidance"
							rows="2"
							placeholder="Make her older and warier; give him a more memorable silhouette…"
						></textarea>
					</label>
					<button type="submit" disabled={data.developing}>Ask the AI to revise the profile</button>
				</form>
			</details>
			{#each data.profile as field (field.kind)}
				<TextItemCard
					item={field.item}
					label={field.label}
					kind={field.kind}
					status={field.status}
					lines={field.kind === 'appearance'
						? 3
						: field.kind === 'name' || field.kind === 'age'
							? 1
							: 2}
					regenerate={{
						action: 'rewriteProfile',
						which: field.kind,
						label: 'Rewrite',
						placeholder: 'Shorter; more sinister; …'
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
					class:faded={refShown.outOfDate.length}
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
				Choose one of the design pictures. Every panel will draw this character from it.
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
		Four different takes on the look, written from the profile. Edit any design's words, then draw
		it; choose the picture you like as the reference.
	</p>
	{#if data.traits?.free.length}
		<details class="traits">
			<summary>What the designs vary</summary>
			<ul>
				{#each data.traits.free as trait, i (i)}<li>{trait}</li>{/each}
			</ul>
			{#if data.traits.fixed.length}
				<p class="hint">Kept the same in every design:</p>
				<ul>
					{#each data.traits.fixed as trait, i (i)}<li>{trait}</li>{/each}
				</ul>
			{/if}
		</details>
	{/if}
	<div class="row">
		<form method="POST" action="?/update" use:enhance>
			<input type="hidden" name="stage" value="designs" />
			<button type="submit" disabled={!data.due.designs}
				>Write out-of-date designs{data.due.designs ? ` (${data.due.designs})` : ''}</button
			>
		</form>
		<form method="POST" action="?/update" use:enhance>
			<input type="hidden" name="stage" value="pictures" />
			<button type="submit" disabled={!data.due.pictures}
				>Draw out-of-date pictures{data.due.pictures ? ` (${data.due.pictures})` : ''}</button
			>
		</form>
		{#if (!data.due.designs && data.flow.designs.stale) || (!data.due.pictures && data.flow.pictures.stale)}
			<span class="hint waiting">
				Out-of-date steps wait for the ones before them: update or keep the
				{!data.due.designs && data.flow.designs.stale ? 'profile' : 'designs'} first.
			</span>
		{/if}
		<form method="POST" action="?/writeDesigns" use:enhance>
			<button type="submit" class="secondary" disabled={!canWrite || data.designing}
				>{hasDesign ? 'Write new designs' : 'Write designs'}</button
			>
		</form>
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
	<h2>4. Character sheet</h2>
	<p class="hint">
		The reference picture redrawn from other angles and with different expressions, so panels can
		show the character any way the script needs. About 10 seconds per picture.
	</p>
	{#if !refCurrent}
		<p class="hint">Choose a reference picture first.</p>
	{:else}
		<div class="row">
			<form method="POST" action="?/update" use:enhance>
				<input type="hidden" name="stage" value="sheet" />
				<button type="submit" disabled={!data.due.sheet}
					>Redraw out-of-date views{data.due.sheet ? ` (${data.due.sheet})` : ''}</button
				>
			</form>
			{#if !data.due.sheet && data.flow.sheet.stale}
				<span class="hint waiting">Choose an up-to-date reference picture first.</span>
			{/if}
			<form method="POST" action="?/sheet" use:enhance>
				<button type="submit" class="secondary" disabled={!data.style}>
					{data.sheet.every((s) => !s.item.currentId)
						? 'Draw the character sheet'
						: 'Redraw the whole sheet'}
				</button>
			</form>
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
			if (!confirm(`Delete ${c.name || 'this character'}?`)) e.preventDefault();
		}}
	>
		<button type="submit" class="danger">Delete character</button>
	</form>
</section>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 16rem;
		gap: 1.5rem;
		align-items: start;
	}
	.pictures {
		position: sticky;
		top: 1rem;
	}
	/* Character pictures are 768×1344. */
	.reference {
		width: 100%;
		aspect-ratio: 4 / 7;
		object-fit: cover;
		border-radius: 6px;
		border: 1px solid var(--line);
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
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: 1rem;
		margin-top: 0.75rem;
	}
	.sheet {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	.traits summary,
	details.card summary {
		cursor: pointer;
		color: var(--muted);
		font-size: 0.9rem;
	}
	details.card form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.5rem;
		justify-items: start;
	}
	details.card label {
		width: 100%;
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
