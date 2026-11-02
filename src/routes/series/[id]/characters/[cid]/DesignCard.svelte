<script lang="ts">
	import { enhance } from '$app/forms';
	import { AutoSave } from '#lib/autosave.svelte.js';
	import { resolve } from '$app/paths';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import Regenerate from '#lib/components/Regenerate.svelte';
	import type { ItemView } from '#lib/server/versions.js';

	/**
	 * One design slot: the design's words (label, appearance, outfit), which
	 * the user can edit, and its picture. Each keeps its own versions.
	 */
	let {
		slot,
		designStatus,
		pictureStatus,
		design,
		picture,
		referenceHash,
		canDraw,
		canWrite
	}: {
		slot: string;
		designStatus: string;
		pictureStatus: string;
		design: ItemView;
		picture: ItemView;
		/** The current reference picture, to mark the one it came from. */
		referenceHash: string | null;
		canDraw: boolean;
		canWrite: boolean;
	} = $props();

	let designViewId = $state<number | null>(null);
	let pictureViewId = $state<number | null>(null);
	let currentDesign = $derived(design.versions.find((v) => v.id === design.currentId));
	let shownDesign = $derived(design.versions.find((v) => v.id === designViewId) ?? currentDesign);
	let currentPicture = $derived(picture.versions.find((v) => v.id === picture.currentId));
	let shownPicture = $derived(
		picture.versions.find((v) => v.id === pictureViewId) ?? currentPicture
	);
	let words = $derived(parse(shownDesign?.text));
	let editable = $derived(!design.pending && shownDesign?.id === currentDesign?.id);
	let name = $derived(`design ${slot}`);
	let title = $derived(words?.label || `Design ${slot}`);

	function parse(text: string | undefined) {
		if (!text) return null;
		try {
			return JSON.parse(text) as { label: string; appearance: string; outfit: string };
		} catch {
			return null;
		}
	}

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
	/** The design's words are saved when the user leaves a changed field. */
	const save = new AutoSave();
</script>

<article class="design" class:stale={shownPicture?.outOfDate.length}>
	<div class="words">
		<h3>Design words</h3>
		<Regenerate
			item={design}
			label={name}
			action="writeDesigns"
			fields={{ which: slot }}
			placeholder="older, heavier, a long coat"
			canGenerate={canWrite}
			upstream={designStatus === 'upstream'}
		/>
		{#if words || editable}
			<form method="POST" action="?/saveDesign" use:enhance={save.enhance} {@attach save.attach}>
				<input type="hidden" name="key" value={slot} />
				<label>
					Label
					<input name="label" value={words?.label ?? ''} readonly={!editable} />
				</label>
				<label>
					Appearance
					<textarea name="appearance" rows="5" readonly={!editable}
						>{words?.appearance ?? ''}</textarea
					>
				</label>
				<label>
					Outfit and props
					<textarea name="outfit" rows="3" readonly={!editable}>{words?.outfit ?? ''}</textarea>
				</label>
				{#if editable}
					<input type="hidden" name="keep" value="on" />
					{#if save.status}<span class="hint" class:error={save.state === 'failed'}
							>{save.status}</span
						>{/if}
				{/if}
			</form>
		{/if}
		{#if currentDesign}
			<VersionNav
				item={design}
				shown={shownDesign}
				label="Design {slot}"
				onview={(v) => (designViewId = v)}
			/>
		{/if}
	</div>
	<figure class="picture">
		{#if picture.pending}
			<div class="placeholder"><span class="spinner"></span> Generating…</div>
		{:else if shownPicture?.assetHash && shownPicture.thumbHash}
			<a href={asset(shownPicture.assetHash)} target="_blank" rel="noopener">
				<img src={asset(shownPicture.thumbHash)} alt="Design option {slot}" loading="lazy" />
			</a>
		{:else}
			<div class="placeholder">Not created</div>
		{/if}

		<strong class="caption">{title}</strong>
		{#if currentDesign}
			<Regenerate
				item={picture}
				label="picture of {name}"
				action="drawPictures"
				fields={{ which: slot }}
				seed
				placeholder="holding the staff"
				canGenerate={canDraw && !design.pending}
				upstream={pictureStatus === 'upstream'}
			/>
		{/if}

		<div class="row actions">
			{#if shownPicture?.assetHash}
				{#if shownPicture.assetHash === referenceHash}
					<span class="chosen"><strong>Reference</strong></span>
				{:else}
					<form method="POST" action="?/choose" use:enhance>
						<input type="hidden" name="versionId" value={shownPicture.id} />
						<button type="submit" class="secondary small" aria-label="Use {name} as reference"
							>Use as reference</button
						>
					</form>
				{/if}
			{/if}
		</div>
		{#if currentPicture}
			<VersionNav
				item={picture}
				shown={shownPicture}
				label="Picture {slot}"
				onview={(v) => (pictureViewId = v)}
			/>
		{/if}
	</figure>
</article>

<style>
	/* One box per design: its words on the left,
	the picture drawn from them on the right. */
	.design {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 15rem;
		gap: var(--space-5);
		align-items: start;
		min-width: 0;
		padding: var(--space-4) var(--space-5);
		background: var(--surface-panel);
		border: var(--border-panel);
	}
	.words,
	.picture {
		display: grid;
		gap: 0.35rem;
		align-content: start;
		min-width: 0;
		margin: 0;
	}
	h3 {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font: 700 13px/1.2 var(--font-body);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--tone-60);
	}
	@media (max-width: 720px) {
		.design {
			grid-template-columns: minmax(0, 1fr);
		}
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
		text-align: center;
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
	.actions {
		gap: 0.4rem;
	}
	.actions form {
		margin: 0;
	}
	.words form {
		display: grid;
		gap: 0.35rem;
		margin-top: 0.35rem;
	}
	.words label {
		font-size: 0.85rem;
	}
	.words input,
	.words textarea {
		width: 100%;
		box-sizing: border-box;
		font-size: 0.85rem;
	}
	textarea[readonly],
	input[readonly] {
		color: var(--muted);
	}
</style>
