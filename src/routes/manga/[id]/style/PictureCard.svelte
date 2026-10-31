<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import type { ItemView } from '#lib/server/versions.js';
	import { outOfDateText } from './labels.js';

	/** One sample picture: browse its versions, and redraw it with a seed and guidance. */
	let { item, label, subject }: { item: ItemView; label: string; subject: string } = $props();

	let viewId = $state<number | null>(null);
	let current = $derived(item.versions.find((v) => v.id === item.currentId));
	let shown = $derived(item.versions.find((v) => v.id === viewId) ?? current);
	let seed = $state<number | null>(null);
	let seedValue = $derived(seed ?? shown?.seed ?? null);

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
	/** A new random seed, as large as the image models accept. */
	const dice = () => (seed = Math.floor(Math.random() * 2 ** 48));
</script>

<div class="picture" class:stale={shown && shown.outOfDate.length}>
	{#if item.pending}
		<div class="placeholder"><span class="spinner"></span> Drawing…</div>
	{:else if shown?.assetHash && shown.thumbHash}
		<a href={asset(shown.assetHash)} target="_blank" rel="noopener">
			<img src={asset(shown.thumbHash)} alt="{label} sample" loading="lazy" />
		</a>
	{:else if item.error}
		<div class="placeholder error">Failed: {item.error}</div>
	{:else}
		<div class="placeholder">Not drawn yet</div>
	{/if}
	<div class="caption">
		<strong>{label}</strong>
		{#if shown?.outOfDate.length}<span class="badge warn">Out of date</span>{/if}
	</div>
	{#if shown?.outOfDate.length}<p class="why">{outOfDateText(shown.outOfDate)}</p>{/if}
	{#if shown}
		<p class="meta">
			Seed {shown.seed ?? 'not recorded'}{#if shown.guidance}<br />Guidance: {shown.guidance}{/if}
		</p>
	{/if}
	<VersionNav {item} {shown} {label} onview={(v) => ((viewId = v), (seed = null))} />
	{#if !item.locked}
		<details class="redraw">
			<summary>{current ? 'Redraw' : 'Draw'}…</summary>
			<form
				method="POST"
				action="?/drawPictures"
				use:enhance={() =>
					({ update }) =>
						update({ reset: false })}
			>
				<input type="hidden" name="which" value={subject} />
				<label for="seed-{subject}">Seed</label>
				<span class="seed">
					<input
						id="seed-{subject}"
						name="seed"
						inputmode="numeric"
						pattern="[0-9]*"
						value={seedValue ?? ''}
						oninput={(e) => (seed = Number(e.currentTarget.value) || null)}
						placeholder="random"
					/>
					<button
						type="button"
						class="secondary small"
						onclick={dice}
						aria-label="New random seed for {label}">🎲</button
					>
				</span>
				<label>
					Guidance (optional)
					<textarea
						name="guidance"
						rows="2"
						placeholder="Lower camera angle, more sky…"
						value={shown?.guidance ?? ''}></textarea>
				</label>
				<button type="submit" class="small" disabled={item.pending}
					>{current ? 'Redraw' : 'Draw'} {label}</button
				>
			</form>
		</details>
	{/if}
</div>

<style>
	.picture {
		margin: 0;
		display: grid;
		gap: 0.3rem;
		align-content: start;
		/* Grid items default to their content's width; the redraw form must not widen the column. */
		min-width: 0;
	}
	.caption {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.why,
	.meta {
		margin: 0;
		font-size: 0.75rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.why {
		color: var(--warn);
	}
	.stale img {
		opacity: 0.45;
	}
	.redraw summary {
		font-size: 0.85rem;
	}
	.redraw form {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.seed {
		display: flex;
		gap: 0.3rem;
	}
	.seed input {
		min-width: 0;
		width: 100%;
		flex: 1;
	}
	textarea {
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
		min-height: 2lh;
	}
</style>
