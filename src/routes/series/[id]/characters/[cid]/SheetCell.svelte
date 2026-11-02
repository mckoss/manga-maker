<script lang="ts">
	import { resolve } from '$app/paths';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import Regenerate from '#lib/components/Regenerate.svelte';
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
		<div class="placeholder"><span class="spinner"></span> Generating…</div>
	{:else if shown?.assetHash && shown.thumbHash}
		<a href={asset(shown.assetHash)} target="_blank" rel="noopener">
			<img src={asset(shown.thumbHash)} alt="{name}: {label}" loading="lazy" />
		</a>
	{:else}
		<div class="placeholder">—</div>
	{/if}
	<strong class="caption">{label}</strong>
	<Regenerate
		{item}
		{label}
		action="sheet"
		fields={{ view }}
		seed
		placeholder="looking over her shoulder"
		canGenerate={canDraw}
		upstream={status === 'upstream'}
	/>
	{#if current}
		<VersionNav {item} {shown} label="{label} view" onview={(v) => (viewId = v)} />
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
		border: var(--border-panel);
		box-sizing: border-box;
		display: block;
	}
	.placeholder {
		background: var(--tone-dots), var(--surface-panel);
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
</style>
