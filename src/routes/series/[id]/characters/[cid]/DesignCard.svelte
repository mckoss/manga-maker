<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import { outOfDateText } from '#lib/components/labels.js';
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
	const keep: SubmitFunction =
		() =>
		async ({ update }) =>
			update({ reset: false });
</script>

<figure class="design" class:stale={shownPicture?.outOfDate.length}>
	{#if picture.pending}
		<div class="placeholder"><span class="spinner"></span> Drawing…</div>
	{:else if shownPicture?.assetHash && shownPicture.thumbHash}
		<a href={asset(shownPicture.assetHash)} target="_blank" rel="noopener">
			<img src={asset(shownPicture.thumbHash)} alt="Design option {slot}" loading="lazy" />
		</a>
	{:else if picture.error}
		<div class="placeholder error">Failed: {picture.error}</div>
	{:else}
		<div class="placeholder">Not drawn yet</div>
	{/if}

	<div class="caption">
		<strong>{title}</strong>
		{#if shownPicture?.outOfDate.length}
			<span class="badge warn">Picture out of date</span>
		{:else if pictureStatus === 'upstream' && !picture.locked}
			<span class="badge muted">Earlier step changed</span>
		{/if}
	</div>
	{#if shownPicture?.outOfDate.length}
		<p class="why">{outOfDateText(shownPicture.outOfDate)}</p>
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
		{#if !picture.locked && currentDesign}
			<form method="POST" action="?/drawPictures" use:enhance>
				<input type="hidden" name="which" value={slot} />
				<button
					type="submit"
					class="secondary small"
					disabled={!canDraw || picture.pending || design.pending}
					aria-label="{currentPicture ? 'Redraw' : 'Draw'} {name}"
					>{currentPicture ? 'Redraw' : 'Draw'}</button
				>
			</form>
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

	<details class="words" open={!currentPicture}>
		<summary>
			Design words
			{#if design.pending}<span class="spinner"></span> writing…{/if}
			{#if shownDesign?.outOfDate.length}<span class="badge warn">Out of date</span>
			{:else if designStatus === 'upstream' && !design.locked}<span class="badge muted"
					>Earlier step changed</span
				>{/if}
		</summary>
		{#if shownDesign?.outOfDate.length}
			<p class="why">{outOfDateText(shownDesign.outOfDate)}</p>
		{/if}
		{#if design.error && !design.pending}<p class="error">Failed: {design.error}</p>{/if}
		{#if words || editable}
			<form method="POST" action="?/saveDesign" use:enhance={keep}>
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
					<span class="save">
						<button type="submit" class="secondary small" aria-label="Save {name}">Save</button>
						<label class="check"><input type="checkbox" name="keep" checked /> and keep it</label>
					</span>
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
		{#if !design.locked}
			<details class="regen">
				<summary>{currentDesign ? 'Rewrite' : 'Write'} with the AI…</summary>
				<form method="POST" action="?/writeDesigns" use:enhance>
					<input type="hidden" name="which" value={slot} />
					<label>
						Guidance (optional)
						<textarea name="guidance" rows="2" placeholder="Older, heavier, a long coat…"
						></textarea>
					</label>
					<button
						type="submit"
						class="secondary small"
						disabled={!canWrite || design.pending}
						aria-label="{currentDesign ? 'Rewrite' : 'Write'} {name}"
						>{currentDesign ? 'Rewrite' : 'Write'}</button
					>
				</form>
			</details>
		{/if}
	</details>
</figure>

<style>
	.design {
		margin: 0;
		min-width: 0;
		display: grid;
		gap: 0.35rem;
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
	.why {
		margin: 0;
		font-size: 0.8rem;
		color: var(--warn);
	}
	.actions {
		gap: 0.4rem;
	}
	.actions form {
		margin: 0;
	}
	summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--muted);
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
	.save {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.regen {
		margin-top: 0.35rem;
	}
</style>
