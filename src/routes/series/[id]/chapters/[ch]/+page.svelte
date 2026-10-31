<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { CHAPTER_PHASES } from '#lib/phases.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let id = $derived(String(data.series.id));
	let ch = $derived(String(data.chapter.id));
</script>

<svelte:head><title>{data.chapter.name} · {data.series.title} · Manga Maker</title></svelte:head>

<h1>{data.chapter.name}</h1>
{#if data.chapter.title}<p class="hint">
		Chapter {data.chapter.number} of {data.series.title}
	</p>{/if}
{#if data.chapter.logline}<p class="logline">{data.chapter.logline}</p>{/if}

<section>
	<h2>Steps</h2>
	<p class="hint">
		The chapter is drawn in the series' style, with characters from the series.
		<a href={resolve('/series/[id]/chapters/[ch]/cast', { id, ch })}>Pick its cast</a> first.
	</p>
	<ol class="steps-overview">
		{#each CHAPTER_PHASES as phase (phase.key)}
			<li>
				<a href={resolve(`/series/[id]/chapters/[ch]/${phase.key}`, { id, ch })}
					><strong>{phase.label}</strong></a
				>
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
		{#if form?.message}<p class="ok">{form.message}</p>{/if}
		<label>
			Title (optional)
			<input
				name="title"
				maxlength="120"
				value={data.chapter.title}
				placeholder="Chapter {data.chapter.number}"
			/>
		</label>
		<label>
			Logline
			<textarea
				name="logline"
				rows="2"
				maxlength="500"
				placeholder="What happens in this chapter, in a sentence or two."
				>{data.chapter.logline}</textarea
			>
		</label>
		<button type="submit">Save</button>
	</form>
</section>

<section class="danger-zone">
	<form
		method="POST"
		action="?/delete"
		onsubmit={(e) => {
			if (!confirm(`Delete "${data.chapter.name}"? Its characters stay in the series.`))
				e.preventDefault();
		}}
	>
		<button type="submit" class="danger">Delete this chapter</button>
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
