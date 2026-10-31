<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { CHAPTER_PHASES, SERIES_PHASES } from '#lib/phases.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let id = $derived(String(data.series.id));
	let styleDone = $derived(data.series.styleStatus === 'ready');
</script>

<h1>{data.series.title}</h1>
{#if data.series.logline}<p class="logline">{data.series.logline}</p>{/if}

<section>
	<h2>Steps</h2>
	<p class="hint">
		A series has one style and one cast of characters and locations, shared by all its chapters.
		Each chapter picks who appears in it and tells its own story. Work through these in order; each
		builds on the one before, and you can always go back.
		{#if !styleDone}Start with the <a href={resolve('/series/[id]/style', { id })}>style</a>.{/if}
	</p>
	<h3>For the whole series</h3>
	<ol class="steps-overview">
		{#each SERIES_PHASES as phase (phase.key)}
			<li>
				<a href={resolve(`/series/[id]/${phase.key}`, { id })}><strong>{phase.label}</strong></a>
				— {phase.summary}
			</li>
		{/each}
	</ol>
	<h3>For each chapter</h3>
	<ol class="steps-overview" start={SERIES_PHASES.length + 1}>
		{#each CHAPTER_PHASES as phase (phase.key)}
			<li><strong>{phase.label}</strong> — {phase.summary}</li>
		{/each}
	</ol>
</section>

<section>
	<h2>Chapters</h2>
	{#if data.chapters.length}
		<ol class="chapter-list">
			{#each data.chapters as chapter (chapter.id)}
				<li>
					<a href={resolve('/series/[id]/chapters/[ch]', { id, ch: String(chapter.id) })}
						>{chapter.name}</a
					>
					{#if chapter.title}<span class="hint">· Chapter {chapter.number}</span>{/if}
					<span class="hint"
						>· {chapter.castSize}
						{chapter.castSize === 1 ? 'character' : 'characters'}</span
					>
					{#if chapter.logline}<br /><span class="hint">{chapter.logline}</span>{/if}
				</li>
			{/each}
		</ol>
	{/if}
	<details class="card wide">
		<summary>Add a chapter</summary>
		<form method="POST" action="?/addChapter" class="stack">
			<label>
				Title (optional)
				<input name="title" maxlength="120" placeholder="Chapter {data.chapters.length + 1}" />
			</label>
			<label>
				Logline (optional)
				<textarea
					name="logline"
					rows="2"
					maxlength="500"
					placeholder="What happens in this chapter, in a sentence or two."></textarea>
			</label>
			<button type="submit">Add chapter</button>
		</form>
	</details>
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
			<input name="title" required maxlength="120" value={data.series.title} />
		</label>
		<label>
			Logline
			<textarea
				name="logline"
				rows="2"
				maxlength="500"
				placeholder="One or two sentences: who wants what, and what stands in the way."
				>{data.series.logline}</textarea
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
						checked={data.series.readingDirection === d.value}
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
			if (!confirm(`Delete "${data.series.title}", every chapter and everything in it?`))
				e.preventDefault();
		}}
	>
		<button type="submit" class="danger">Delete this series</button>
	</form>
</section>

<style>
	.logline {
		font-size: 1.1rem;
		color: var(--muted);
	}
	.steps-overview,
	.chapter-list {
		line-height: 1.8;
	}
	h3 {
		font-size: 1rem;
		margin: 1rem 0 0;
	}
	.stack {
		display: grid;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
</style>
