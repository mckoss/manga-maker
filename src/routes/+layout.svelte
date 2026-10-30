<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import type { LayoutProps } from './$types';
	import '../app.css';

	let { children, data }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Manga Maker</title>
</svelte:head>

<header>
	<a class="name" href={resolve('/')}>Manga Maker</a>
	<span class="version">v{__APP_VERSION__}</span>
	{#if data.user}
		<nav>
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
