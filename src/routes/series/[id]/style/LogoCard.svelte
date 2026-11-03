<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import Regenerate from '#lib/components/Regenerate.svelte';
	import type { LogoDetail } from '#lib/server/logos.js';

	/**
	 * The series logo: what it is drawn from on the left, the picture on the
	 * right. It needs a protagonist with a reference picture.
	 */
	let { logo, seriesId, logline }: { logo: LogoDetail; seriesId: string; logline: string } =
		$props();

	let viewId = $state<number | null>(null);
	let item = $derived(logo.item);
	let current = $derived(item.versions.find((v) => v.id === item.currentId));
	let shown = $derived(item.versions.find((v) => v.id === viewId) ?? current);

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
</script>

<div class="logo" class:unselected={shown && shown.id !== item.currentId}>
	<div class="from">
		<p class="hint">
			A branding mark for the whole series, shown wherever the series appears: in the sidebar, on
			the cover in your library. It is drawn from your protagonist’s reference picture, in front of
			a typical scene from the story.
		</p>
		<dl>
			<dt>Protagonist</dt>
			<dd>
				{#if logo.protagonist}
					<a
						href={resolve('/series/[id]/characters/[cid]', {
							id: seriesId,
							cid: String(logo.protagonist.id)
						})}>{logo.protagonist.name || 'Your protagonist'}</a
					>
				{:else}
					<span class="missing">None with a reference picture yet</span>
				{/if}
			</dd>
			<dt>Scene</dt>
			<dd>
				{#if logline}{logline}{:else}<span class="missing"
						>No logline: the style’s description stands in</span
					>{/if}
			</dd>
		</dl>
		{#if !logo.protagonist}
			<p class="notice">
				First, add a protagonist on the <a
					href={resolve('/series/[id]/characters', { id: seriesId })}>Characters</a
				> step and choose their reference picture. Once the Locations step is built, the logo will use
				your default location as its background.
			</p>
		{/if}
		{#if item.pending}
			<form method="POST" action="?/stopLogo" use:enhance class="row">
				<span class="hint"><span class="spinner"></span> Generating the logo…</span>
				<button type="submit" class="danger small">Stop</button>
			</form>
		{:else}
			<Regenerate
				{item}
				label="the logo"
				action="drawLogo"
				seed
				placeholder="sword raised, cherry blossoms behind"
				canGenerate={logo.canDraw}
			/>
		{/if}
		{#if current}
			<VersionNav {item} {shown} label="Logo" scope="series" onview={(v) => (viewId = v)} />
		{/if}
	</div>

	<figure>
		{#if shown?.assetHash && shown.thumbHash}
			<a href={asset(shown.assetHash)} target="_blank" rel="noopener">
				<img src={asset(shown.thumbHash)} alt="Series logo" />
			</a>
		{:else}
			<div class="placeholder">
				{#if item.pending}<span class="spinner"></span> Generating…{:else}Not created{/if}
			</div>
		{/if}
	</figure>
</div>

<style>
	/* What the logo is drawn from on the left,
	the logo on the right. */
	.logo {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 15rem;
		gap: var(--space-5);
		align-items: start;
		padding: var(--space-4) var(--space-5);
		background: var(--surface-panel);
		border: var(--border-panel);
	}
	.from {
		display: grid;
		gap: var(--space-3);
		align-content: start;
		min-width: 0;
	}
	.from > p {
		margin: 0;
	}
	dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-1) var(--space-4);
		margin: 0;
	}
	dt {
		font: var(--type-label);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--tone-60);
		padding-top: 4px;
	}
	dd {
		margin: 0;
	}
	.missing {
		color: var(--tone-60);
	}
	.notice {
		padding: var(--space-2) var(--space-3);
		border: var(--border-control);
		border-left: 4px solid var(--shu);
	}
	figure {
		margin: 0;
	}
	img,
	.placeholder {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		box-sizing: border-box;
		border: var(--border-panel);
	}
	.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		font: var(--type-hint);
		color: var(--tone-60);
		background: var(--tone-dots), var(--surface-panel);
	}
	.unselected img {
		opacity: 0.45;
	}
	@media (max-width: 720px) {
		.logo {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
