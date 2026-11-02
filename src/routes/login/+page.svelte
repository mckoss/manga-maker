<script lang="ts">
	import Landing from '#lib/components/Landing.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head><title>Sign in · Manga Maker</title></svelte:head>

<Landing>
	<form method="POST" class="signin">
		<h2>Sign in</h2>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<label>
			Username
			<input
				name="username"
				autocomplete="username"
				autocapitalize="none"
				required
				value={form?.username ?? ''}
			/>
		</label>
		<label>
			Password
			<input name="password" type="password" autocomplete="current-password" required />
		</label>
		<button type="submit">Sign in</button>
	</form>
</Landing>

<style>
	.signin {
		display: grid;
		gap: var(--space-3);
		max-width: 22rem;
		padding: var(--space-4) var(--space-5) var(--space-5);
		border: var(--border-panel);
		background: var(--surface-page);
	}
	h2 {
		margin: 0;
		font: var(--type-heading);
		font-size: 22px;
	}
	button {
		justify-self: start;
	}
</style>
