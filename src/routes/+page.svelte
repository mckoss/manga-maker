<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const STYLE_STATUS = {
		none: 'Style not started',
		started: 'Style in progress',
		ready: 'Style ready'
	} as const;
</script>

<div class="title-row">
	<h1>My manga</h1>
	<a class="button" href={resolve('/series/new')}>New series</a>
</div>

{#if data.series.length === 0}
	<p>
		Manga Maker walks you through making a comic series, step by step: its style, characters and
		locations, then for each chapter the plot, script, panels and pages.
	</p>
	<p><a class="button" href={resolve('/series/new')}>Start your first series</a></p>
{:else}
	<ul class="collection">
		{#each data.series as s (s.id)}
			<li>
				<a href={resolve('/series/[id]', { id: String(s.id) })}>
					{#if s.thumb}
						<img src={resolve('/assets/[hash]', { hash: s.thumb })} alt="" loading="lazy" />
					{:else}
						<div class="no-cover" aria-hidden="true">{s.title.slice(0, 1)}</div>
					{/if}
					<strong>{s.title}</strong>
					<small
						>{s.chapterCount}
						{s.chapterCount === 1 ? 'chapter' : 'chapters'} · {STYLE_STATUS[s.styleStatus]}</small
					>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.collection {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 1.25rem;
	}
	.collection a {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		color: inherit;
		text-decoration: none;
	}
	.collection img,
	.no-cover {
		width: 100%;
		aspect-ratio: 3 / 4;
		object-fit: cover;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--card);
	}
	.no-cover {
		display: grid;
		place-items: center;
		font-size: 3rem;
		color: var(--muted);
	}
	.collection a:hover img,
	.collection a:hover .no-cover {
		border-color: var(--accent);
	}
	small {
		color: var(--muted);
	}
</style>
