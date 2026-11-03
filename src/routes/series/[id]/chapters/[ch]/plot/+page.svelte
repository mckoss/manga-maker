<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { AutoSave } from '#lib/autosave.svelte.js';
	import TextItemCard from '#lib/components/TextItemCard.svelte';
	import Regenerate from '#lib/components/Regenerate.svelte';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import { everythingLabel } from '#lib/components/batch.js';
	import BeatCard from './BeatCard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let plot = $derived(data.plot);
	let chapter = $derived(page.data.chapter as { title: string; logline: string; name: string });
	let seriesId = $derived(String(page.data.series.id));

	// While AI jobs run, reload the page data every two seconds to show progress.
	$effect(() => {
		if (!plot.busy) return;
		const timer = setInterval(() => invalidateAll(), 2000);
		return () => clearInterval(timer);
	});

	const STEPS = [
		{ key: 'idea', label: 'Your idea', href: '#idea', made: 'by you' },
		{ key: 'structure', label: 'Structure', href: '#structure', made: 'suggested, chosen by you' },
		{ key: 'elements', label: 'Story elements', href: '#elements', made: 'by the AI' },
		{ key: 'beats', label: 'Beats', href: '#beats', made: 'by the AI' },
		{ key: 'review', label: 'Editor’s review', href: '#review', made: 'by the AI' }
	] as const;

	type Summary = (typeof plot.flow)['structure'];
	function stepState(key: (typeof STEPS)[number]['key'], s: Summary) {
		if (s.pending) return { tone: 'busy', text: 'working…' };
		if (key === 'idea') return s.missing ? { tone: 'todo', text: 'empty' } : null;
		if (s.total === 0 || s.missing === s.total) return { tone: 'todo', text: 'not made yet' };
		if (s.stale) return { tone: 'stale', text: `${s.stale} to update` };
		if (s.missing) return { tone: 'todo', text: `${s.missing} not made` };
		return null;
	}
	let due = $derived(Object.values(plot.due).reduce((a, b) => a + b, 0));
	let everything = $derived(
		everythingLabel([plot.flow.structure, plot.flow.elements, plot.flow.beats, plot.flow.review])
	);

	let structureView = $state<number | null>(null);
	let structureCurrent = $derived(
		plot.structure.item.versions.find((v) => v.id === plot.structure.item.currentId)
	);
	let structureShown = $derived(
		plot.structure.item.versions.find((v) => v.id === structureView) ?? structureCurrent
	);

	let answers = $state<string[]>([]);
	let askedIn: number | null = null;
	$effect(() => {
		if (plot.questions.item.currentId === askedIn) return;
		askedIn = plot.questions.item.currentId;
		answers = plot.questions.list.map(() => '');
	});

	const idea = new AutoSave();
	const pagesSave = new AutoSave();
</script>

<svelte:head><title>Plot · {chapter.name} · Manga Maker</title></svelte:head>

<h1>Plot</h1>
<p class="hint">
	Build the chapter’s story arc: choose a structure, settle the story elements (the conflict, the
	climax, how it resolves and ends), then outline it beat by beat. The AI drafts every part; edit
	anything and it is locked, so the AI keeps your version. Who is in each beat makes the chapter’s
	cast.
</p>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.message}<p class="ok" role="status">{form.message}</p>{/if}

<nav class="flow" aria-label="How the plot is made">
	<ol>
		{#each STEPS as step (step.key)}
			{@const s = plot.flow[step.key]}
			{@const st = stepState(step.key, s)}
			<li class={st?.tone ?? 'ok'}>
				<!-- In-page links to the step's section. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={step.href}>
					<strong>{step.label}</strong>
					<small>{step.made}</small>
					<span class="state">
						{#if st}{st.text}{:else}✓ up to date{/if}
						{#if s.kept}· {s.kept} locked{/if}
					</span>
				</a>
			</li>
		{/each}
	</ol>
	<form method="POST" action="?/update" use:enhance>
		<button type="submit" disabled={due === 0}>{everything}</button>
		<span class="hint">
			Step by step, from the structure to the editor’s review. What you locked is kept.
		</span>
	</form>
</nav>

<section id="idea">
	<h2>1. Your idea</h2>
	<form
		method="POST"
		action="?/saveLogline"
		class="card wide"
		use:enhance={idea.enhance}
		{@attach idea.attach}
	>
		<input type="hidden" name="title" value={chapter.title} />
		<label>
			Logline
			<textarea
				name="logline"
				rows="2"
				maxlength="500"
				placeholder="One or two sentences: who wants what in this chapter, and what stands in the way."
				>{chapter.logline}</textarea
			>
		</label>
		{#if idea.status}<span class="hint" class:error={idea.state === 'failed'}>{idea.status}</span
			>{/if}
	</form>
	<TextItemCard
		item={plot.notes}
		label="Your notes"
		kind="notes"
		action="saveNotes"
		lines={5}
		lockable={false}
		notesBy="AI story editor"
		placeholder="Anything you already picture: a scene, a twist, how it ends, the mood."
	/>
	<form
		method="POST"
		action="?/savePages"
		class="row pages"
		use:enhance={pagesSave.enhance}
		{@attach pagesSave.attach}
	>
		<label>
			Length in pages
			<input name="pages" type="number" min="1" max="200" value={plot.pageTarget} />
		</label>
		<span class="hint">A typical chapter is 16–24 pages. The beats are paced to fit.</span>
	</form>

	{#if plot.questions.item.pending}
		<p class="hint"><span class="spinner"></span> The story editor is reading your idea…</p>
	{:else if plot.questions.list.length}
		<div class="card wide mentor questions">
			<p>
				<strong>AI story editor:</strong> A few questions about your idea. Answer any you like; your answers
				are added to your notes.
			</p>
			<form method="POST" action="?/answerQuestions" use:enhance>
				{#each plot.questions.list as q, i (i)}
					<fieldset>
						<legend>{q.question}</legend>
						{#if q.suggestions.length}
							<div class="suggestions">
								{#each q.suggestions as suggestion (suggestion)}
									<button
										type="button"
										class="secondary small"
										class:chosen={answers[i] === suggestion}
										onclick={() => (answers[i] = suggestion)}>{suggestion}</button
									>
								{/each}
							</div>
						{/if}
						<input
							name="answer"
							aria-label="Answer: {q.question}"
							placeholder="Or in your own words"
							bind:value={answers[i]}
						/>
					</fieldset>
				{/each}
				<div class="row">
					<button type="submit" disabled={!answers.some((a) => a.trim())}
						>Add my answers to my notes</button
					>
					<button type="submit" class="secondary" formaction="?/skipQuestions"
						>Skip these questions</button
					>
				</div>
			</form>
		</div>
	{:else if plot.hasIdea}
		<form method="POST" action="?/askQuestions" use:enhance>
			<button type="submit" class="secondary small">Ask the story editor what’s missing</button>
		</form>
	{/if}
</section>

<section id="structure">
	<h2>2. Structure</h2>
	<p class="hint">
		The shape of the chapter’s arc. The AI suggests one for your idea; choose any, and the story
		elements and beats follow it.
	</p>
	<Regenerate
		item={plot.structure.item}
		label="structure suggestion"
		action="regenerate"
		fields={{ which: 'structure' }}
		placeholder="it's a quiet chapter, no villain"
		canGenerate={plot.hasIdea}
		waiting="Write the logline or your notes first."
		upstream={plot.structure.status === 'upstream'}
	/>
	{#if plot.structure.reason}
		<p class="mentor"><strong>AI story editor:</strong> {plot.structure.reason}</p>
	{/if}
	<div class="structures" role="list">
		{#each data.structures as st (st.key)}
			<article
				class="structure card"
				class:chosen={plot.structure.key === st.key}
				role="listitem"
				aria-label={st.label}
			>
				<h3>
					{st.label}
					{#if plot.structure.key === st.key}<span class="badge">In use</span>{/if}
					{#if plot.structure.suggested === st.key}<span class="badge muted">Suggested</span>{/if}
				</h3>
				<p class="hint">{st.bestFor}</p>
				<ol class="beats-list">
					{#each st.beats as b (b.key)}<li title={b.hint}>{b.label}</li>{/each}
				</ol>
				{#if plot.structure.key !== st.key || !plot.structure.item.locked}
					<form method="POST" action="?/chooseStructure" use:enhance>
						<input type="hidden" name="structure" value={st.key} />
						<button type="submit" class="secondary small" aria-label="Use {st.label}"
							>Use this structure</button
						>
					</form>
				{/if}
			</article>
		{/each}
	</div>
	{#if structureCurrent}
		<VersionNav
			item={plot.structure.item}
			shown={structureShown}
			label="Structure"
			onview={(v) => (structureView = v)}
		/>
	{/if}
</section>

<section id="elements">
	<h2>3. Story elements</h2>
	<p class="hint">
		The parts of the arc, settled before the outline: what the protagonist wants and risks, the
		conflict and who opposes them, the climax, the resolution, and the ending.
	</p>
	{#if !plot.structure.key}
		<p class="hint">Choose a structure first.</p>
	{:else}
		{#if plot.elementNotes}
			<p class="mentor"><strong>AI story editor:</strong> {plot.elementNotes}</p>
		{/if}
		<div class="elements">
			{#each plot.elements as e (e.kind)}
				<TextItemCard
					item={e.item}
					label={e.label}
					kind={e.kind}
					action="saveElement"
					lines={3}
					placeholder={e.hint}
					status={e.status}
					regenerate={{ action: 'regenerate', which: e.kind, placeholder: 'raise the stakes' }}
				/>
			{/each}
		</div>
	{/if}
</section>

<section id="beats">
	<h2>4. Beats</h2>
	<p class="hint">
		The outline, one beat at a time in the structure’s shape, paced to {plot.pageTarget} pages{plot
			.beats.length
			? `: ${plot.pagesPlanned} planned`
			: ''}. Who is in each beat makes the chapter’s
		<a
			href={resolve('/series/[id]/chapters/[ch]/cast', {
				id: seriesId,
				ch: String(page.params.ch)
			})}>cast</a
		>{plot.cast.length ? `: ${plot.cast.map((c) => c.name).join(', ')}` : ''}. A new name adds the
		character to the series, to develop on the
		<a href={resolve('/series/[id]/characters', { id: seriesId })}>Characters</a> page.
	</p>
	{#if !plot.beats.length}
		<p class="hint">Choose a structure first.</p>
	{:else}
		{#if plot.beatNotes}
			<p class="mentor"><strong>AI story editor:</strong> {plot.beatNotes}</p>
		{/if}
		{#each plot.beats as beat, i (beat.key)}
			<BeatCard {beat} people={plot.people} number={i + 1} />
		{/each}
	{/if}
</section>

<section id="review">
	<h2>5. Editor’s review</h2>
	<p class="hint">
		The story editor reads the outline: does the conflict escalate, is the climax earned, are setups
		paid off, does the pacing fit?
	</p>
	<Regenerate
		item={plot.review.item}
		label="review"
		action="regenerate"
		fields={{ which: 'review' }}
		placeholder="look hard at the ending"
		canGenerate={plot.beats.length > 0 && plot.beats.every((b) => b.value)}
		waiting="Write the beats first."
		upstream={plot.review.status === 'upstream'}
	/>
	{#if plot.review.notes.length}
		<ul class="review">
			{#each plot.review.notes as n, i (i)}
				<li class={n.kind}>
					<strong>{n.kind === 'issue' ? 'Issue' : 'Strength'}:</strong>
					{n.text}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.flow {
		margin: var(--space-3) 0 var(--space-5);
	}
	.flow ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) 0;
		align-items: stretch;
		counter-reset: step;
	}
	.flow li {
		display: flex;
		align-items: center;
		counter-increment: step;
	}
	/* An ink arrow between steps */
	.flow li:not(:last-child)::after {
		content: '';
		width: 18px;
		height: 10px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 10' fill='%23141210'%3E%3Cpath d='M0 4h12v2H0z'/%3E%3Cpath d='M11 0l7 5-7 5z'/%3E%3C/svg%3E")
			center / contain no-repeat;
	}
	.flow a {
		display: grid;
		gap: 2px;
		min-width: 7.5rem;
		padding: 8px 12px;
		border: var(--border-control);
		background: var(--surface-panel);
		color: var(--ink);
		font: 700 14px/1.2 var(--font-body);
		text-decoration: none;
	}
	.flow a::before {
		content: counter(step, decimal-leading-zero);
		font: 700 10px var(--font-mono);
		color: var(--tone-60);
	}
	.flow a:hover {
		color: var(--ink);
		box-shadow: var(--shadow-ink-sm);
	}
	.flow small {
		font: 400 11px var(--font-body);
		color: var(--muted);
	}
	.flow .state {
		font: 600 12px var(--font-body);
	}
	.flow .ok .state {
		color: var(--ok);
	}
	.flow .stale a {
		border: var(--border-stale);
	}
	.flow .stale .state {
		color: var(--warn);
	}
	.flow .todo .state,
	.flow .busy .state {
		color: var(--muted);
	}
	.flow form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	.flow form .hint {
		margin: 0;
	}
	section {
		display: grid;
		gap: var(--space-3);
		margin-block: var(--space-6);
	}
	.pages input {
		width: 6em;
	}
	.structures {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: var(--space-3);
	}
	.structure {
		display: grid;
		gap: var(--space-2);
		align-content: start;
	}
	.structure.chosen {
		border-color: var(--shu);
		box-shadow: var(--shadow-shu);
	}
	.structure h3 {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		margin: 0;
		font: 700 15px/1.3 var(--font-body);
	}
	.structure p {
		margin: 0;
	}
	.beats-list {
		margin: 0;
		padding-left: 1.3em;
		font-size: 13px;
	}
	.elements {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: var(--space-3);
	}
	.review {
		display: grid;
		gap: var(--space-2);
		padding: 0;
		list-style: none;
	}
	.review li {
		padding: var(--space-2) var(--space-3);
		border-left: 4px solid var(--tone-60);
		background: var(--surface-panel);
	}
	.review li.issue {
		border-left-color: var(--warn);
	}
	.questions fieldset {
		display: grid;
		gap: var(--space-2);
	}
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chosen {
		outline: 2px solid var(--shu);
	}
</style>
