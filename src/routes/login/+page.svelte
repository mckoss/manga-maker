<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head><title>Sign in · Manga Maker</title></svelte:head>

<form method="POST" class="card">
	<h1>Sign in</h1>
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
