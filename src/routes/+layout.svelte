<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Manga Maker</title>
</svelte:head>

<header>
	<span class="name">Manga Maker</span>
	<span class="version">v{__APP_VERSION__}</span>
</header>

<main>
	{@render children()}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		color: #1a1a1a;
		background: #fafafa;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #ddd;
	}
	.name {
		font-weight: 600;
	}
	.version {
		font-size: 0.75rem;
		color: #888;
	}
	main {
		padding: 1rem;
	}
</style>
