<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { PHASES } from '#lib/phases.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let id = $derived(String(data.manga.id));
	let styleDone = $derived(data.manga.styleStatus === 'ready');
</script>

<h1>{data.manga.title}</h1>
{#if data.manga.logline}<p class="logline">{data.manga.logline}</p>{/if}

<section>
	<h2>Steps</h2>
	<p class="hint">
		Work through these in order; each builds on the one before, and you can always go back.
		{#if !styleDone}Start with the <a href={resolve('/manga/[id]/style', { id })}>style</a>.{/if}
	</p>
	<ol class="steps-overview">
		{#each PHASES as phase (phase.key)}
			<li>
				<a href={resolve(`/manga/[id]/${phase.key}`, { id })}><strong>{phase.label}</strong></a>
				— {phase.summary}
			</li>
		{/each}
	</ol>
</section>

<section>
	<h2>Settings</h2>
	<form
		method="POST"
		action="?/save"
		class="card wide"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
	>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.message}<p class="ok">{form.message}</p>{/if}
		<label>
			Title
			<input name="title" required maxlength="120" value={data.manga.title} />
		</label>
		<label>
			Logline
			<textarea
				name="logline"
				rows="2"
				maxlength="500"
				placeholder="One or two sentences: who wants what, and what stands in the way."
				>{data.manga.logline}</textarea
			>
		</label>
		<fieldset>
			<legend>Reading direction</legend>
			{#each data.directions as d (d.value)}
				<label class="check">
					<input
						type="radio"
						name="readingDirection"
						value={d.value}
						checked={data.manga.readingDirection === d.value}
					/>
					{d.label} <span class="hint">— {d.hint}</span>
				</label>
			{/each}
		</fieldset>
		<button type="submit">Save</button>
	</form>
</section>

<section class="danger-zone">
	<form
		method="POST"
		action="?/delete"
		onsubmit={(e) => {
			if (!confirm(`Delete "${data.manga.title}" and everything in it?`)) e.preventDefault();
		}}
	>
		<button type="submit" class="danger">Delete this manga</button>
	</form>
</section>

<style>
	.logline {
		font-size: 1.1rem;
		color: var(--muted);
	}
	.steps-overview {
		line-height: 1.8;
	}
</style>
