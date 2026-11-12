<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PageCard from './PageCard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let script = $derived(data.script);
	let chapter = $derived(page.data.chapter as { name: string });
	let plotHref = $derived(
		resolve('/series/[id]/chapters/[ch]/plot', {
			id: String(page.params.id),
			ch: String(page.params.ch)
		})
	);
	let beatOptions = $derived(script.beats.map((b) => ({ key: b.key, label: b.label })));

	// While AI jobs run, reload the page data every two seconds to show progress.
	$effect(() => {
		if (!script.busy) return;
		const timer = setInterval(() => invalidateAll(), 2000);
		return () => clearInterval(timer);
	});

	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
</script>

<svelte:head><title>Script · {chapter.name} · Manga Maker</title></svelte:head>

<h1>Script</h1>
<p class="hint">
	Turn the plot into pages, panels and words. You write the script: what each page is for, what each
	panel shows, and every line a reader reads. When you ask, the AI can help lay out a beat or fill a
	page’s blanks; it only fills what is empty, and never writes the words or rewrites what you wrote.
	{#if script.hasOutline}
		Pages read {script.readingDirection === 'rtl' ? 'right to left, as manga do' : 'left to right'}.
	{/if}
</p>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

{#if !script.hasOutline}
	<div class="card wide empty">
		<p><strong>The script starts from the plot.</strong></p>
		<p class="hint">
			Outline the chapter beat by beat on the <a href={plotHref}>Plot</a> page first. Each beat becomes
			a group of pages here, ready for you to fill in.
		</p>
	</div>
{:else}
	<ol class="steps-strip" aria-label="How the script is made">
		<li><strong>Pages</strong> <small>what each page is for</small></li>
		<li><strong>Panels</strong> <small>what each panel shows</small></li>
		<li><strong>Words</strong> <small>what they say</small></li>
	</ol>
	<p class="hint totals">
		{plural(script.totals.pages, 'page')} of {script.pageTarget} planned · {plural(
			script.totals.panels,
			'panel'
		)} · {plural(script.totals.blocks, 'balloon or caption', 'balloons and captions')}
	</p>

	{#each script.beats as beat, i (beat.key)}
		{@const laidOut = beat.pages.length}
		<section class="beat" aria-label="Beat: {beat.label}">
			<header class="beat-head">
				<h2><span class="n">{i + 1}</span> {beat.label}</h2>
				<span
					class="count"
					class:warn={laidOut > 0 && laidOut !== beat.plannedPages}
					class:todo={laidOut === 0}
				>
					Planned: {plural(beat.plannedPages, 'page')} · Laid out: {laidOut}
				</span>
			</header>
			{#if beat.text}
				<blockquote class="summary">{beat.text}</blockquote>
			{:else}
				<p class="hint">{beat.hint} This beat isn’t written yet on the Plot page.</p>
			{/if}
			{#if beat.pending}
				<p class="hint"><span class="spinner"></span> Laying out this beat…</p>
			{/if}
			{#if beat.error}<p class="error" role="alert">{beat.error}</p>{/if}

			{#each beat.pages as p (p.id)}
				<PageCard
					page={p}
					people={script.people}
					places={script.places}
					first={p.id === beat.pages[0].id}
					last={p.id === beat.pages[laidOut - 1].id}
				/>
			{:else}
				<p class="hint">
					No pages yet. Add one and say what it is for: the one moment the reader should take from
					it.
				</p>
			{/each}

			<div class="row beat-actions">
				<form method="POST" action="?/addPage" use:enhance>
					<input type="hidden" name="beat" value={beat.key} />
					<button type="submit" class="secondary small" aria-label="Add a page to {beat.label}"
						>Add a page</button
					>
				</form>
				{#if laidOut === 0 && beat.text && !beat.pending}
					<form method="POST" action="?/helpLayout" use:enhance>
						<input type="hidden" name="beat" value={beat.key} />
						<button type="submit" class="secondary small" aria-label="Help me lay out {beat.label}"
							>Help me lay out this beat</button
						>
					</form>
					<span class="hint"
						>The AI drafts the pages and what each panel shows, with a cue where words go. The words
						are yours.</span
					>
				{/if}
			</div>
		</section>
	{/each}

	{#if script.orphans.length}
		<section class="beat orphans" aria-label="Pages from an earlier outline">
			<h2>Pages from an earlier outline</h2>
			<p class="hint">
				These pages belong to beats that are no longer in the plot. Move each to a beat, or delete
				it.
			</p>
			{#each script.orphans as p, i (p.id)}
				<PageCard
					page={p}
					people={script.people}
					places={script.places}
					beats={beatOptions}
					first={i === 0}
					last={i === script.orphans.length - 1}
				/>
			{/each}
		</section>
	{/if}
{/if}

<style>
	.beat-actions {
		gap: var(--space-2);
		justify-content: flex-start;
		align-items: center;
	}
	.beat-actions .hint {
		margin: 0;
	}
	.empty p {
		margin: 0;
	}
	.steps-strip {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-3) 0;
		padding: 0;
		counter-reset: step;
	}
	.steps-strip li {
		display: grid;
		gap: 2px;
		padding: 6px 12px;
		border: var(--border-control);
		background: var(--surface-panel);
		font: 700 14px/1.2 var(--font-body);
		counter-increment: step;
	}
	.steps-strip li::before {
		content: counter(step, decimal-leading-zero);
		font: 700 10px var(--font-mono);
		color: var(--tone-60);
	}
	.steps-strip small {
		font: 400 11px var(--font-body);
		color: var(--muted);
	}
	.totals {
		margin: 0;
	}
	.beat {
		display: grid;
		gap: var(--space-3);
		margin-block: var(--space-6);
	}
	.beat-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2) var(--space-4);
	}
	.beat-head h2 {
		margin: 0;
	}
	.n {
		display: inline-grid;
		place-items: center;
		width: 1.4em;
		height: 1.4em;
		margin-right: 0.2em;
		background: var(--ink);
		color: var(--paper);
		font-size: 0.7em;
	}
	.count {
		font: 600 13px var(--font-body);
		color: var(--ok);
	}
	.count.todo {
		color: var(--muted);
	}
	.count.warn {
		color: var(--warn);
	}
	.summary {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-left: 4px solid var(--tone-40);
		background: var(--surface-page);
		font-style: italic;
		white-space: pre-wrap;
	}
	.beat form {
		margin: 0;
	}
	.orphans {
		padding: var(--space-4) var(--space-5);
		border: var(--border-dash);
		background: var(--surface-page);
	}
	.orphans h2 {
		margin: 0;
	}
</style>
