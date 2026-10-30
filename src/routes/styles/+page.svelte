<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Styles · Manga Maker</title></svelte:head>

<div class="title-row">
	<h1>Styles</h1>
	<a class="button" href={resolve('/styles/new')}>New style</a>
</div>

<p class="hint">
	A style is the drawing look of a comic: line work, shading, colour. Approve a style before drawing
	characters, so their reference sheets are made in it. Styles can be reused across comics.
</p>

{#if data.styles.length === 0}
	<p>No styles yet. <a href={resolve('/styles/new')}>Create your first style.</a></p>
{:else}
	<ul class="style-list">
		{#each data.styles as style (style.id)}
			<li>
				<a href={resolve('/styles/[id]', { id: String(style.id) })}>
					<div class="thumbs">
						{#each style.thumbs as hash (hash)}
							<img src={resolve('/assets/[hash]', { hash })} alt="" loading="lazy" />
						{:else}
							<div class="empty-thumb">No samples yet</div>
						{/each}
					</div>
					<div class="meta">
						<strong>{style.name}</strong>
						{#if style.active}
							<span class="badge">v{style.active.number} approved</span>
						{:else}
							<span class="badge muted">not approved yet</span>
						{/if}
						{#if style.hasDraft && style.active}<span class="badge muted">revision in progress</span
							>{/if}
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}
