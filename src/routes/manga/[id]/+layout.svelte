<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { PHASES } from '#lib/phases.js';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	let id = $derived(String(data.manga.id));
	let current = $derived(page.url.pathname.split('/')[3] ?? '');
	const STYLE_BADGE = { none: 'not started', started: 'in progress', ready: 'ready' } as const;
</script>

<svelte:head><title>{data.manga.title} · Manga Maker</title></svelte:head>

<div class="manga">
	<nav class="sidebar" aria-label="Steps">
		<a
			class="title"
			href={resolve('/manga/[id]', { id })}
			aria-current={current === '' ? 'page' : undefined}>{data.manga.title}</a
		>
		<ol>
			{#each PHASES as phase (phase.key)}
				<li>
					<a
						href={resolve(`/manga/[id]/${phase.key}`, { id })}
						aria-current={current === phase.key ? 'page' : undefined}
					>
						<span>{phase.label}</span>
						{#if phase.key === 'style'}
							<small class="status {data.manga.styleStatus}"
								>{STYLE_BADGE[data.manga.styleStatus]}</small
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
	</nav>
	<div class="content">
		{@render children()}
	</div>
</div>

<style>
	.manga {
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
		.manga {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
		}
		.sidebar {
			position: static;
			min-width: 0;
		}
		ol {
			flex-direction: row;
			overflow-x: auto;
		}
		ol a {
			white-space: nowrap;
		}
		a[aria-current='page'] {
			box-shadow: inset 0 -3px 0 var(--accent);
		}
	}
</style>
