<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { CHAPTER_PHASES, SERIES_PHASES } from '#lib/phases.js';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	let id = $derived(String(data.series.id));
	let parts = $derived(page.url.pathname.split('/'));
	/** The series step, or "chapters", from /series/[id]/<step>. */
	let current = $derived(parts[3] ?? '');
	let currentChapter = $derived(current === 'chapters' ? parts[4] : undefined);
	let chapterStep = $derived(currentChapter ? (parts[5] ?? '') : undefined);
	const STYLE_BADGE = { none: 'not started', started: 'in progress', ready: 'ready' } as const;
</script>

<svelte:head><title>{data.series.title} · Manga Maker</title></svelte:head>

<div class="series">
	<nav class="sidebar" aria-label="Steps">
		<a
			class="title"
			href={resolve('/series/[id]', { id })}
			aria-current={current === '' ? 'page' : undefined}>{data.series.title}</a
		>
		<ol class="steps">
			{#each SERIES_PHASES as phase (phase.key)}
				<li>
					<a
						href={resolve(`/series/[id]/${phase.key}`, { id })}
						aria-current={current === phase.key ? 'page' : undefined}
					>
						<span>{phase.label}</span>
						{#if phase.key === 'style'}
							<small class="status {data.series.styleStatus}"
								>{STYLE_BADGE[data.series.styleStatus]}</small
							>
						{:else if phase.key === 'characters' && data.castSize}
							<small
								class="status"
								class:approved={data.castReady === data.castSize}
								title="{data.castReady} of {data.castSize} have a reference picture"
								>{data.castReady}/{data.castSize}</small
							>
						{/if}
					</a>
				</li>
			{/each}
		</ol>
		<p class="group">Chapters</p>
		<ul class="chapters">
			{#each data.chapters as chapter (chapter.id)}
				{@const ch = String(chapter.id)}
				<li>
					<a
						class="chapter"
						href={resolve('/series/[id]/chapters/[ch]', { id, ch })}
						aria-current={currentChapter === ch && chapterStep === '' ? 'page' : undefined}
						>{chapter.name}</a
					>
					{#if currentChapter === ch}
						<ol class="steps">
							{#each CHAPTER_PHASES as phase (phase.key)}
								<li>
									<a
										href={resolve(`/series/[id]/chapters/[ch]/${phase.key}`, { id, ch })}
										aria-current={chapterStep === phase.key ? 'page' : undefined}
									>
										<span>{phase.label}</span>
										{#if phase.key === 'cast' && chapter.castSize}
											<small class="status">{chapter.castSize}</small>
										{/if}
									</a>
								</li>
							{/each}
						</ol>
					{/if}
				</li>
			{/each}
		</ul>
	</nav>
	<div class="content">
		{@render children()}
	</div>
</div>

<style>
	.series {
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr);
		gap: 2rem;
		align-items: start;
	}
	.sidebar {
		position: sticky;
		top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.title {
		font-weight: 600;
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		color: inherit;
		text-decoration: none;
	}
	.group {
		margin: 0.75rem 0 0;
		padding: 0 0.6rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
	}
	.chapters {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.chapter {
		display: block;
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		color: inherit;
		text-decoration: none;
	}
	.chapters .steps {
		margin-left: 0.75rem;
	}
	ol {
		list-style: none;
		counter-reset: step;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	li {
		counter-increment: step;
	}
	ol a {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		color: inherit;
		text-decoration: none;
	}
	ol a span::before {
		content: counter(step) '. ';
		color: var(--muted);
	}
	a:hover {
		background: var(--card);
	}
	a[aria-current='page'] {
		background: var(--card);
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.status {
		color: var(--muted);
		font-size: 0.75rem;
	}
	.status.ready,
	.status.approved {
		color: var(--accent);
	}
	.content {
		min-width: 0;
	}
	@media (max-width: 720px) {
		.series {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
		}
		.sidebar {
			position: static;
			min-width: 0;
		}
		ol,
		.chapters {
			flex-direction: row;
			overflow-x: auto;
		}
		ol a,
		.chapter {
			white-space: nowrap;
		}
		.chapters {
			flex-wrap: wrap;
		}
		/* The open chapter's steps get a row of their own. */
		.chapters li:has(.steps) {
			display: contents;
		}
		.chapters .steps {
			order: 1;
			flex-basis: 100%;
			margin-left: 0;
		}
		a[aria-current='page'] {
			box-shadow: inset 0 -3px 0 var(--accent);
		}
	}
</style>
