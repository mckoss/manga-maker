<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// While AI jobs run, reload the page data every two seconds to show progress.
	$effect(() => {
		if (!data.busy) return;
		const timer = setInterval(() => invalidateAll(), 2000);
		return () => clearInterval(timer);
	});

	/** Submit without clearing what the user typed. */
	const keep: SubmitFunction =
		() =>
		async ({ update }) =>
			update({ reset: false });

	/** Where the profile form stands, shown beside its Save button. */
	let saveState = $state<'saved' | 'dirty' | 'saving'>('saved');
	const save: SubmitFunction = () => {
		saveState = 'saving';
		return async ({ update }) => {
			await update({ reset: false });
			saveState = 'saved';
		};
	};

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
	let id = $derived(String(data.series.id));
	let c = $derived(data.character);
	let drawing = $derived(data.candidates.some((i) => i.pending));
	let undrawnCount = $derived(data.candidates.filter((i) => i.undrawn).length);
	let anyStale = $derived(data.candidates.some((i) => i.assetHash && (i.stale || i.oldStyle)));
	let canDraw = $derived(Boolean(data.style && c.appearance && !data.developing));
	let sheetEmpty = $derived(data.sheet.every((s) => !s.image));
	let sheetOutdated = $derived(data.sheet.some((s) => s.image?.assetHash && s.image.outdated));
</script>

<svelte:head><title>{c.name || 'Character'} · {data.series.title} · Manga Maker</title></svelte:head
>

<p><a href={resolve('/series/[id]/characters', { id })}>← Characters</a></p>

<div class="title-row">
	<h1>{c.name || 'New character'}</h1>
	{#if data.reference}
		<span class="badge">reference chosen</span>
	{:else}
		<span class="badge muted">designing</span>
	{/if}
</div>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.message}<p class="ok">{form.message}</p>{/if}

{#if data.developing}
	<p class="mentor"><span class="spinner"></span> The AI is developing the profile…</p>
{:else if data.developError}
	<p class="error">The AI could not develop the profile: {data.developError}</p>
{:else if c.notes}
	<p class="mentor"><strong>AI story editor:</strong> {c.notes}</p>
{/if}

<div class="layout">
	<div>
		<form
			method="POST"
			action="?/save"
			class="card wide"
			use:enhance={save}
			oninput={() => (saveState = 'dirty')}
		>
			<fieldset disabled={data.developing}>
				<legend>Story</legend>
				<div class="row">
					<label>
						Name
						<input name="name" maxlength="80" value={c.name} />
					</label>
					<label>
						Role
						<select name="role">
							{#each data.roles as role (role.value)}
								<option value={role.value} selected={c.role === role.value}>{role.label}</option>
							{/each}
						</select>
					</label>
				</div>
				<label>
					Your notes
					<textarea name="brief" rows="2">{c.brief}</textarea>
				</label>
				<label>
					Personality
					<textarea name="personality" rows="2">{c.personality}</textarea>
				</label>
				<label>
					Wants and needs
					<textarea name="motivation" rows="2">{c.motivation}</textarea>
				</label>
				<label>
					Backstory
					<textarea name="backstory" rows="2">{c.backstory}</textarea>
				</label>
				<label>
					How they talk
					<input name="speech" value={c.speech} />
				</label>
			</fieldset>
			<fieldset disabled={data.developing}>
				<legend>Look</legend>
				<p class="hint">
					These words are what the image model draws from. Describe only what is visible.
				</p>
				<label>
					Age
					<input name="age" value={c.age} />
				</label>
				<label>
					Appearance
					<textarea name="appearance" rows="3">{c.appearance}</textarea>
				</label>
				<label>
					Outfit and props
					<textarea name="outfit" rows="2">{c.outfit}</textarea>
				</label>
			</fieldset>
			<div class="row save-row">
				<button type="submit" disabled={data.developing || saveState === 'saving'}>Save</button>
				<span class="save-status" role="status">
					{#if saveState === 'saving'}
						Saving…
					{:else if saveState === 'dirty'}
						Unsaved changes
					{:else if form?.saveError}
						<span class="error">{form.saveError}</span>
					{:else if form?.saved}
						<span class="ok">{form.saved}</span>
					{/if}
				</span>
			</div>
		</form>

		<form method="POST" action="?/develop" class="card wide" use:enhance>
			<label>
				What should change?
				<textarea
					name="feedback"
					rows="2"
					placeholder="Make her older and warier; give him a more memorable silhouette…"></textarea>
			</label>
			<button type="submit" disabled={data.developing}>Ask the AI to revise the profile</button>
		</form>
	</div>

	<section class="pictures">
		<h2>Reference picture</h2>
		{#if data.reference?.assetHash && data.reference.thumbHash}
			<a href={asset(data.reference.assetHash)} target="_blank" rel="noopener">
				<img
					class="reference"
					src={asset(data.reference.thumbHash)}
					alt="{c.name} reference"
					class:faded={data.reference.stale || data.reference.oldStyle}
				/>
			</a>
			{#if data.reference.oldStyle}
				<p class="hint">Drawn in an older version of the style. Draw new options to update it.</p>
			{:else if data.reference.stale}
				<p class="hint">The look has changed since this was drawn.</p>
			{/if}
		{:else}
			<p class="hint">
				Draw design options, then choose the one that fits best. Every panel will draw this
				character from it.
			</p>
		{/if}
	</section>
</div>

<section>
	<h2>Design options</h2>
	{#if !data.style}
		<p class="hint">
			Pictures are drawn in the series' style: <a href={resolve('/series/[id]/style', { id })}
				>draw a sample picture of the style</a
			> first.
		</p>
	{/if}
	<p class="hint">
		Each option is a different take on the character's look. The AI writes new ones whenever the
		look above changes. Edit any design's words, then draw it; choosing one makes its appearance and
		outfit the character's.
	</p>
	{#if data.designing}
		<p class="mentor"><span class="spinner"></span> The AI is writing design options…</p>
	{:else if c.designTraits?.free.length}
		<details class="traits">
			<summary>What the designs vary</summary>
			<ul>
				{#each c.designTraits.free as trait, i (i)}<li>{trait}</li>{/each}
			</ul>
			{#if c.designTraits.fixed.length}
				<p class="hint">Kept the same in every design:</p>
				<ul>
					{#each c.designTraits.fixed as trait, i (i)}<li>{trait}</li>{/each}
				</ul>
			{/if}
		</details>
	{/if}
	{#if anyStale}
		<p class="hint">Faded pictures were drawn from an older look or style.</p>
	{/if}
	{#if data.candidates.length}
		<div class="samples portrait designs">
			{#each data.candidates as img, i (img.id)}
				{@const label = img.variant || `Design ${i + 1}`}
				<figure class:stale={img.stale || img.oldStyle}>
					{#if img.assetHash && img.thumbHash}
						<a href={asset(img.assetHash)} target="_blank" rel="noopener">
							<img src={asset(img.thumbHash)} alt="Design option {i + 1}" loading="lazy" />
						</a>
					{:else if img.pending}
						<div class="placeholder">
							<span class="spinner"></span>
							{img.prompt ? 'Drawing…' : 'Designing…'}
						</div>
					{:else if img.error}
						<div class="placeholder error">Failed: {img.error}</div>
					{:else if img.undrawn}
						<div class="placeholder">Not drawn yet</div>
					{:else}
						<div class="placeholder">Canceled</div>
					{/if}
					{#if img.variant}<figcaption class="variant">{img.variant}</figcaption>{/if}
					{#if img.assetHash}
						{#if img.id === c.referenceImageId}
							<p class="chosen"><strong>Reference</strong></p>
						{:else}
							<form method="POST" action="?/choose" use:enhance>
								<input type="hidden" name="imageId" value={img.id} />
								<button type="submit" class="secondary small">Use as reference</button>
							</form>
						{/if}
					{/if}
					{#if img.appearance !== null && !img.pending}
						{@const drawn = Boolean(img.assetHash)}
						<details class="design" open={img.undrawn}>
							<summary>{drawn ? 'Edit and redraw…' : 'Design'}</summary>
							<form method="POST" action="?/drawDesign" use:enhance={keep}>
								<input type="hidden" name="imageId" value={img.id} />
								<label>
									Label
									<input name="variant" value={img.variant ?? ''} />
								</label>
								<label>
									Appearance
									<textarea name="appearance" rows="5">{img.appearance}</textarea>
								</label>
								<label>
									Outfit and props
									<textarea name="outfit" rows="3">{img.outfit ?? ''}</textarea>
								</label>
								{#if form?.designError && form.imageId === img.id}
									<p class="error" role="alert">{form.designError}</p>
								{/if}
								<button
									type="submit"
									class="secondary small"
									disabled={!data.style}
									aria-label="{drawn ? 'Redraw' : 'Draw'} {label}"
									>{drawn ? 'Redraw' : 'Draw'}</button
								>
							</form>
						</details>
					{/if}
				</figure>
			{/each}
		</div>
	{/if}
	<div class="row">
		<form method="POST" action="?/draw" use:enhance>
			<button type="submit" disabled={!canDraw || data.designing || !undrawnCount}>
				{undrawnCount > 1
					? `Draw all ${undrawnCount} designs`
					: undrawnCount
						? 'Draw the new design'
						: 'Draw the designs'}
			</button>
		</form>
		<form method="POST" action="?/designs" use:enhance>
			<button
				type="submit"
				class="secondary"
				disabled={!c.appearance || data.developing || data.designing}
				>{data.candidates.length ? 'Write new designs' : 'Write design options'}</button
			>
		</form>
		{#if drawing}<span class="hint">About 5–10 seconds per picture.</span>{/if}
	</div>
</section>

<section>
	<h2>Character sheet</h2>
	<p class="hint">
		The reference picture redrawn from other angles and with different expressions, so panels can
		show the character any way the script needs. About 10 seconds per picture.
	</p>
	{#if !data.reference}
		<p class="hint">Choose a reference picture first.</p>
	{:else}
		{#if sheetOutdated}
			<p class="hint">Faded pictures were drawn from a different reference picture.</p>
		{/if}
		{#if !sheetEmpty}
			<div class="samples portrait">
				{#each data.sheet as cell (cell.view)}
					<figure class:stale={cell.image?.outdated}>
						{#if cell.image?.assetHash && cell.image.thumbHash}
							<a href={asset(cell.image.assetHash)} target="_blank" rel="noopener">
								<img
									src={asset(cell.image.thumbHash)}
									alt="{c.name}: {cell.label}"
									loading="lazy"
								/>
							</a>
						{:else if cell.image?.error}
							<div class="placeholder error">Failed: {cell.image.error}</div>
						{:else if cell.image?.pending}
							<div class="placeholder"><span class="spinner"></span> Drawing…</div>
						{:else}
							<div class="placeholder">—</div>
						{/if}
						<figcaption>
							{cell.label}
							<details class="redraw">
								<summary>Redraw…</summary>
								<form method="POST" action="?/sheet" use:enhance>
									<input type="hidden" name="view" value={cell.view} />
									<label>
										Guidance (optional)
										<textarea
											name="guidance"
											rows="2"
											placeholder="Looking over her shoulder, mouth closed…"></textarea>
									</label>
									<button
										type="submit"
										class="secondary small"
										disabled={cell.image?.pending}
										aria-label="Redraw {cell.label}">Redraw</button
									>
								</form>
							</details>
						</figcaption>
					</figure>
				{/each}
			</div>
		{/if}
		<form method="POST" action="?/sheet" use:enhance>
			<button type="submit" disabled={!data.style}>
				{sheetEmpty ? 'Draw the character sheet' : 'Redraw the whole sheet'}
			</button>
		</form>
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
	.pictures h2 {
		margin-top: 1rem;
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
	.portrait img,
	.portrait .placeholder {
		aspect-ratio: 4 / 7;
	}
	.portrait form {
		margin-top: 0.35rem;
	}
	.redraw summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.redraw textarea {
		min-height: 2lh;
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
	.save-row {
		align-items: center;
	}
	.save-status {
		font-size: 0.9rem;
		color: var(--muted);
	}
	.save-status .ok,
	.save-status .error {
		margin: 0;
	}
	.design summary,
	.traits summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.design label {
		font-size: 0.85rem;
	}
	.design input,
	.design textarea {
		width: 100%;
		box-sizing: border-box;
		font-size: 0.85rem;
	}
	.designs figure {
		min-width: 0;
	}
	.variant {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.chosen {
		margin: 0;
	}
</style>
