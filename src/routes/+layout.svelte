<script lang="ts">
	import favicon from '#lib/assets/favicon.png';
	import bookLogo from '#lib/assets/logo-book.png';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	// Self-hosted webfonts (Latin subsets) for the design system's four faces.
	import '@fontsource/dela-gothic-one/latin-400.css';
	import '@fontsource/zen-kaku-gothic-new/latin-400.css';
	import '@fontsource/zen-kaku-gothic-new/latin-500.css';
	import '@fontsource/zen-kaku-gothic-new/latin-700.css';
	import '@fontsource/zen-kaku-gothic-new/latin-900.css';
	import '@fontsource/shantell-sans/latin-400.css';
	import '@fontsource/shantell-sans/latin-600.css';
	import '@fontsource/shantell-sans/latin-800.css';
	import '@fontsource/shantell-sans/latin-600-italic.css';
	import '@fontsource/ibm-plex-mono/latin-400.css';
	import '@fontsource/ibm-plex-mono/latin-500.css';
	import '../app.css';

	let { children, data }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<title>Manga Maker</title>
</svelte:head>

<header>
	<a class="name" href={resolve('/')} aria-label="Manga Maker">
		<img class="book" src={bookLogo} alt="" width="22" height="44" />
		<span aria-hidden="true">MANGA<span class="dot">·</span>MAKER</span>
	</a>
	<span class="version">v{__APP_VERSION__}</span>
	{#if data.user}
		<nav>
			<a href={resolve('/')} aria-current={page.url.pathname === '/' ? 'page' : undefined}
				>My manga</a
			>
			{#if data.user.isAdmin}<a href={resolve('/admin/users')}>Users</a>{/if}
			<a href={resolve('/account')}>{data.user.username}</a>
			<form method="POST" action={resolve('/logout')}>
				<button type="submit" class="link">Sign out</button>
			</form>
		</nav>
	{/if}
</header>

<main>
	{@render children()}
</main>
