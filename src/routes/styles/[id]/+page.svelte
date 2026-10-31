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

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
	const date = (d: Date | null) => d?.toLocaleDateString() ?? '';
	let draftSampling = $derived(data.draftSamples.some((s) => s.sample && !s.sample.assetHash));
	let draftStale = $derived(data.draftSamples.some((s) => s.stale));
	let draftEmpty = $derived(data.draftSamples.every((s) => !s.sample));
</script>

<svelte:head><title>{data.style.name} · Styles · Manga Maker</title></svelte:head>

{#snippet samples(row: typeof data.draftSamples)}
	<div class="samples">
		{#each row as cell (cell.subject)}
			<figure class:stale={cell.stale}>
				{#if cell.sample?.thumbHash && cell.sample.assetHash}
					<a href={asset(cell.sample.assetHash)} target="_blank" rel="noopener">
						<img src={asset(cell.sample.thumbHash)} alt="{cell.label} sample" loading="lazy" />
					</a>
				{:else if cell.sample?.error}
					<div class="placeholder error">Failed: {cell.sample.error}</div>
				{:else if cell.sample?.pending}
					<div class="placeholder"><span class="spinner"></span> Drawing…</div>
				{:else if cell.sample}
					<div class="placeholder">Cancelled</div>
				{:else}
					<div class="placeholder">—</div>
				{/if}
				<figcaption>{cell.label}{cell.stale ? ' (older prompt)' : ''}</figcaption>
			</figure>
		{/each}
	</div>
{/snippet}

<p><a href={resolve('/styles')}>← Styles</a></p>

<div class="title-row">
	<h1>{data.style.name}</h1>
	{#if data.active}
		<span class="badge">v{data.active.number} approved</span>
	{:else}
		<span class="badge muted">not approved yet</span>
	{/if}
</div>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.message}<p class="ok">{form.message}</p>{/if}

{#if data.active}
	<section>
		<h2>In use: version {data.active.number}</h2>
		<p class="hint">
			Approved {date(data.active.approvedAt)} · {data.colorLabels[data.active.colorMode]} ·
			{data.active.model}
		</p>
		<p class="prompt">{data.active.prompt}</p>
		{@render samples(data.activeSamples)}
		{#if !data.draft}
			<form method="POST" action="?/revise" use:enhance>
				<button type="submit">Revise this style</button>
				<span class="hint"
					>Changes happen in a draft; this version stays in use until you approve the new one.</span
				>
			</form>
		{/if}
	</section>
{/if}

{#if data.draft}
	{@const draft = data.draft}
	<section class="draft">
		<h2>{data.active ? `Revision: draft version ${draft.number}` : 'Draft'}</h2>

		<div class="steps">
			<ol>
				<li>Check the AI's prompt, or edit it yourself.</li>
				<li>Generate samples to see the style on five test subjects.</li>
				<li>Tell the AI what to change, and repeat until you like it.</li>
				<li>Approve. {data.active ? 'The new version replaces the one in use.' : ''}</li>
			</ol>
		</div>

		{#if data.refining}
			<p class="mentor"><span class="spinner"></span> The AI is rewriting the prompt…</p>
		{:else if data.refineError}
			<p class="error">The AI could not revise the prompt: {data.refineError}</p>
		{:else if draft.notes}
			<p class="mentor"><strong>AI art director:</strong> {draft.notes}</p>
		{/if}

		<form method="POST" action="?/save" class="card wide" use:enhance={keep}>
			<input type="hidden" name="versionId" value={draft.id} />
			<label>
				Description
				<textarea name="description" rows="2">{draft.description}</textarea>
			</label>
			<div class="row">
				<label>
					Colour
					<select name="colorMode">
						{#each data.colorModes as mode (mode.value)}
							<option value={mode.value} selected={draft.colorMode === mode.value}
								>{mode.label}</option
							>
						{/each}
					</select>
				</label>
				<label>
					Image model
					<select name="model">
						{#each data.models as model (model.value)}
							<option value={model.value} selected={draft.model === model.value}
								>{model.label}</option
							>
						{/each}
					</select>
				</label>
			</div>
			<label>
				Style prompt
				<textarea name="prompt" rows="4" disabled={data.refining}>{draft.prompt}</textarea>
			</label>
			<label>
				Keep out of every image
				<input
					name="avoid"
					value={draft.avoid}
					disabled={data.refining}
					placeholder="modern clothing, electric wires, cars"
				/>
				<span class="hint"
					>The image models can't take a "don't draw" list, so the AI rewrites the prompt and scenes
					to describe what is there instead. Ask it to revise after changing this.</span
				>
			</label>
			<fieldset>
				<legend>Sample scenes</legend>
				<p class="hint">
					What each test image shows. The AI writes these to fit your style's setting; edit them
					freely.
				</p>
				{#each data.draftScenes as scene (scene.key)}
					<label>
						{scene.label}
						<input name="scene_{scene.key}" value={scene.scene} disabled={data.refining} />
					</label>
				{/each}
			</fieldset>
			<button type="submit" disabled={data.refining}>Save draft</button>
		</form>

		<form method="POST" action="?/refine" class="card wide" use:enhance>
			<input type="hidden" name="versionId" value={draft.id} />
			<label>
				What should change?
				<textarea
					name="feedback"
					rows="2"
					placeholder="Thicker outlines, fewer screentones, softer faces…"></textarea>
			</label>
			<button type="submit" disabled={data.refining}>Ask the AI to revise the prompt</button>
		</form>

		<h3>Samples</h3>
		{#if draftStale}
			<p class="hint">Some samples were drawn from an older prompt. Generate again to compare.</p>
		{/if}
		{#if data.active && !draftEmpty}
			<p class="row-label">In use: version {data.active.number}</p>
			{@render samples(data.activeSamples)}
			<p class="row-label">This draft (same seeds, so differences come from the prompt)</p>
		{/if}
		{#if !draftEmpty}{@render samples(data.draftSamples)}{/if}
		<form method="POST" action="?/samples" class="row" use:enhance>
			<input type="hidden" name="versionId" value={draft.id} />
			<button type="submit" disabled={!draft.prompt || data.refining}>
				{draftEmpty ? 'Generate samples' : 'Generate samples again'}
			</button>
			<label class="check">
				<input type="checkbox" name="newSeed" /> New random variations
			</label>
			{#if draftSampling}<span class="hint">About 5–10 seconds per image.</span>{/if}
		</form>

		<div class="row actions">
			<form method="POST" action="?/approve" use:enhance>
				<input type="hidden" name="versionId" value={draft.id} />
				<button type="submit" disabled={!data.canApprove || data.busy}>Approve this style</button>
			</form>
			{#if data.active}
				<form method="POST" action="?/discard" use:enhance>
					<input type="hidden" name="versionId" value={draft.id} />
					<button type="submit" class="secondary">Discard draft</button>
				</form>
			{/if}
		</div>
		{#if !data.canApprove}
			<p class="hint">Approval needs a full set of samples made from the current prompt.</p>
		{/if}
	</section>
{/if}

{#if data.history.some((v) => v.id !== data.active?.id)}
	<section>
		<h2>History</h2>
		{#each data.history.filter((v) => v.id !== data.active?.id) as version (version.id)}
			<details>
				<summary>
					Version {version.number} · approved {date(version.approvedAt)}
				</summary>
				<p class="prompt">{version.prompt}</p>
				{@render samples(data.historySamples[version.id])}
				{#if !data.draft}
					<form method="POST" action="?/revise" use:enhance>
						<input type="hidden" name="fromVersionId" value={version.id} />
						<button type="submit" class="secondary">Start a revision from this version</button>
					</form>
				{/if}
			</details>
		{/each}
	</section>
{/if}

<section class="danger-zone">
	<form method="POST" action="?/rename" class="row" use:enhance={keep}>
		<input name="name" value={data.style.name} maxlength="80" aria-label="Style name" />
		<button type="submit" class="secondary">Rename</button>
	</form>
	<form
		method="POST"
		action="?/delete"
		onsubmit={(e) => {
			if (!confirm(`Delete the style "${data.style.name}" and all its versions?`))
				e.preventDefault();
		}}
	>
		<button type="submit" class="danger">Delete style</button>
	</form>
</section>
