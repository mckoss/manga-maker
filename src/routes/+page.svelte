<script lang="ts">
	import { resolve } from '$app/paths';
	import Landing from '#lib/components/Landing.svelte';
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
	<Landing>
		<a class="button" href={resolve('/series/new')}>Start your first series</a>
	</Landing>
{:else}
	<ul class="collection">
		{#each data.series as s (s.id)}
			<li>
				<a href={resolve('/series/[id]', { id: String(s.id) })}>
					<div class="cover">
						<span class="spine" aria-hidden="true">
							<span class="seal"></span>
							<span class="spine-title">{s.title}</span>
						</span>
						{#if s.thumb}
							<img src={resolve('/assets/[hash]', { hash: s.thumb })} alt="" loading="lazy" />
						{:else}
							<div class="no-cover" aria-hidden="true"><span>{s.title.slice(0, 1)}</span></div>
						{/if}
					</div>
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
		grid-template-columns: repeat(auto-fill, minmax(min(11rem, 40%), 1fr));
		gap: var(--space-6) var(--space-5);
	}
	.collection a {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		color: var(--ink);
		text-decoration: none;
	}
	.cover {
		display: flex;
		aspect-ratio: 3 / 4;
		overflow: hidden;
		border: var(--border-panel);
		background: var(--surface-panel);
		transition:
			transform var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out);
	}
	.collection a:hover .cover {
		transform: translate(-2px, -2px);
		box-shadow: var(--shadow-ink);
	}
	/* A tankōbon spine: ink strip, seal, vertical title, volume number */
	.spine {
		flex: none;
		width: 22px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		background: var(--ink);
		color: var(--paper);
		font: 400 10px/1 var(--font-display);
	}
	.spine .seal {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--shu);
	}
	.spine-title {
		writing-mode: vertical-rl;
		letter-spacing: 0.08em;
		white-space: nowrap;
		overflow: hidden;
		min-height: 0;
		flex: 1;
	}
	.cover img,
	.no-cover {
		flex: 1;
		min-width: 0;
		height: 100%;
		object-fit: cover;
	}
	.no-cover {
		display: grid;
		place-items: center;
	}
	.no-cover span {
		padding: 0 var(--space-2);
		background: var(--surface-panel);
		font: 400 56px/1 var(--font-display);
		color: var(--ink);
	}
	strong {
		font: 400 16px/1.2 var(--font-display);
	}
	small {
		font: 400 12px/1.4 var(--font-body);
		color: var(--tone-60);
	}
</style>
