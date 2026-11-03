<script lang="ts">
	import { resolve } from '$app/paths';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import Regenerate from '#lib/components/Regenerate.svelte';
	import type { ItemView } from '#lib/server/versions.js';

	/**
	 * One sample picture: its state, how to regenerate it, and its versions.
	 * `status` is where it stands in the pipeline ("upstream": its prompt or
	 * scene is out of date).
	 */
	let {
		item,
		label,
		subject,
		status
	}: { item: ItemView; label: string; subject: string; status: string } = $props();

	let viewId = $state<number | null>(null);
	let current = $derived(item.versions.find((v) => v.id === item.currentId));
	let shown = $derived(item.versions.find((v) => v.id === viewId) ?? current);

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
</script>

<div class="picture" class:unselected={shown && shown.id !== item.currentId}>
	{#if item.pending}
		<div class="placeholder"><span class="spinner"></span> Generating…</div>
	{:else if shown?.assetHash && shown.thumbHash}
		<a href={asset(shown.assetHash)} target="_blank" rel="noopener">
			<img src={asset(shown.thumbHash)} alt="{label} sample" loading="lazy" />
		</a>
	{:else}
		<div class="placeholder">Not created</div>
	{/if}
	<strong class="caption">{label}</strong>
	<Regenerate
		{item}
		{label}
		action="drawPictures"
		fields={{ which: subject }}
		seed
		placeholder="lower camera angle, more sky"
		upstream={status === 'upstream'}
	/>
	{#if shown}<p class="meta">Seed {shown.seed ?? 'not recorded'}</p>{/if}
	<VersionNav {item} {shown} {label} onview={(v) => (viewId = v)} />
</div>

<style>
	.picture {
		margin: 0;
		display: grid;
		gap: 0.4rem;
		align-content: start;
		/* Grid items default to their content's width; the controls must not widen the column. */
		min-width: 0;
	}
	.caption {
		font: 700 14px var(--font-body);
	}
	.meta {
		margin: 0;
		font: 400 11px var(--font-mono);
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.unselected img {
		opacity: 0.45;
	}
</style>
