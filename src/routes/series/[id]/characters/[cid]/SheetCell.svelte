<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import { outOfDateText } from '#lib/components/labels.js';
	import type { ItemView } from '#lib/server/versions.js';

	/** One view or expression of the character sheet, with its versions. */
	let {
		view,
		label,
		name,
		item,
		status,
		canDraw
	}: {
		view: string;
		label: string;
		name: string;
		item: ItemView;
		status: string;
		canDraw: boolean;
	} = $props();

	let viewId = $state<number | null>(null);
	let current = $derived(item.versions.find((v) => v.id === item.currentId));
	let shown = $derived(item.versions.find((v) => v.id === viewId) ?? current);
	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
</script>

<figure class:stale={shown?.outOfDate.length}>
	{#if item.pending}
		<div class="placeholder"><span class="spinner"></span> Drawing…</div>
	{:else if shown?.assetHash && shown.thumbHash}
		<a href={asset(shown.assetHash)} target="_blank" rel="noopener">
			<img src={asset(shown.thumbHash)} alt="{name}: {label}" loading="lazy" />
		</a>
	{:else if item.error}
		<div class="placeholder error">Failed: {item.error}</div>
	{:else}
		<div class="placeholder">—</div>
	{/if}
	<div class="caption">
		{label}
		{#if shown?.outOfDate.length}<span class="badge warn">Out of date</span>
		{:else if status === 'upstream' && !item.locked}<span class="badge muted"
				>Earlier step changed</span
			>{/if}
	</div>
	{#if shown?.outOfDate.length}<p class="why">{outOfDateText(shown.outOfDate)}</p>{/if}
	{#if shown?.guidance}<p class="meta">Guidance: {shown.guidance}</p>{/if}
	{#if current}
		<VersionNav {item} {shown} label="{label} view" onview={(v) => (viewId = v)} />
	{/if}
	{#if !item.locked}
		<details class="redraw">
			<summary>Redraw…</summary>
			<form method="POST" action="?/sheet" use:enhance>
				<input type="hidden" name="view" value={view} />
				<label>
					Guidance (optional)
					<textarea
						name="guidance"
						rows="2"
						placeholder="Looking over her shoulder, mouth closed…"
						value={shown?.guidance ?? ''}></textarea>
				</label>
				<button
					type="submit"
					class="secondary small"
					disabled={!canDraw || item.pending}
					aria-label="Redraw {label}">Redraw</button
				>
			</form>
		</details>
	{/if}
</figure>

<style>
	figure {
		margin: 0;
		min-width: 0;
		display: grid;
		gap: 0.3rem;
		align-content: start;
	}
	img,
	.placeholder {
		width: 100%;
		aspect-ratio: 4 / 7;
		object-fit: cover;
		border-radius: 6px;
		border: 1px solid var(--line);
		display: block;
	}
	.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.stale img {
		opacity: 0.5;
	}
	.caption {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
		font-size: 0.9rem;
	}
	.why,
	.meta {
		margin: 0;
		font-size: 0.8rem;
	}
	.why {
		color: var(--warn);
	}
	.meta {
		color: var(--muted);
	}
	summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--muted);
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		font-size: 0.85rem;
	}
</style>
