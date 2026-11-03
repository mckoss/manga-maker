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
			aria-current={current === '' ? 'page' : undefined}
			>{#if data.series.logo}<img
					class="seal logo"
					src={resolve('/assets/[hash]', { hash: data.series.logo })}
					alt=""
				/>{:else}<span class="seal" aria-hidden="true">{data.series.title.slice(0, 1)}</span
				>{/if}<span>{data.series.title}</span></a
		>
		<p class="group">For the whole series</p>
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
						{:else if phase.key === 'locations' && data.placesSize}
							<small
								class="status"
								class:approved={data.placesReady === data.placesSize}
								title="{data.placesReady} of {data.placesSize} have a reference picture"
								>{data.placesReady}/{data.placesSize}</small
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
		grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
		gap: var(--space-6);
		align-items: start;
	}
	.sidebar {
		position: sticky;
		top: var(--space-4);
		display: flex;
		flex-direction: column;
	}
	.title {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 10px;
		border: var(--border-panel);
		background: var(--surface-panel);
		color: var(--ink);
		font: 400 16px/1.15 var(--font-display);
		text-decoration: none;
	}
	.title[aria-current='page'] {
		background: var(--ink);
		color: var(--paper);
	}
	.seal.logo {
		width: 44px;
		height: 44px;
		object-fit: cover;
		background: var(--paper);
		border: 2px solid var(--ink);
		box-sizing: border-box;
	}
	.seal {
		flex: none;
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--shu);
		color: #fff;
		font: 400 13px/1 var(--font-display);
	}
	.group {
		margin: var(--space-4) 10px 6px;
		font: var(--type-label);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--tone-60);
	}
	.chapters {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.chapter {
		display: block;
		padding: 7px 10px;
		border-left: 4px solid transparent;
		color: var(--ink);
		font: 500 14px var(--font-body);
		text-decoration: none;
	}
	.chapter[aria-current='page'] {
		background: var(--surface-sunk);
		border-left-color: var(--shu);
	}
	.chapters .steps {
		margin: 2px 0 var(--space-2) var(--space-3);
	}
	ol {
		list-style: none;
		counter-reset: step;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li {
		counter-increment: step;
	}
	ol a {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: 7px 10px;
		border-left: 4px solid transparent;
		color: var(--ink);
		text-decoration: none;
	}
	ol a span {
		margin-right: auto;
		font: 700 14px var(--font-body);
	}
	ol a span::before {
		content: counter(step, decimal-leading-zero);
		display: inline-block;
		min-width: 22px;
		font: 700 11px var(--font-mono);
		color: var(--tone-60);
	}
	ol a:hover,
	.chapter:hover {
		background: var(--surface-sunk);
		color: var(--ink);
	}
	ol a[aria-current='page'] {
		background: var(--ink);
		color: var(--paper);
		border-left-color: var(--shu);
	}
	ol a[aria-current='page'] span::before,
	ol a[aria-current='page'] .status {
		color: var(--tone-20);
	}
	.status {
		font: 400 11px var(--font-body);
		color: var(--tone-60);
	}
	.status.ready,
	.status.approved {
		color: var(--ok);
	}
	.content {
		min-width: 0;
	}
	@media (max-width: 720px) {
		.series {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-4);
		}
		.sidebar {
			position: static;
			min-width: 0;
		}
		.group {
			display: none;
		}
		.title {
			margin-bottom: var(--space-2);
		}
		ol,
		.chapters {
			flex-direction: row;
			overflow-x: auto;
		}
		ol a,
		.chapter {
			white-space: nowrap;
			border-left: none;
			border-bottom: 4px solid transparent;
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
		ol a[aria-current='page'],
		.chapter[aria-current='page'] {
			border-bottom-color: var(--shu);
		}
	}
</style>
