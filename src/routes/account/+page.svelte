<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head><title>Account · Manga Maker</title></svelte:head>

<h1>Account</h1>
<p>Signed in as <strong>{page.data.user?.username}</strong>.</p>

<form method="POST" action="?/password" class="card">
	<h2>Change password</h2>
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	{#if form?.message}<p class="ok">{form.message}</p>{/if}
	<label>
		Current password
		<input name="current" type="password" autocomplete="current-password" required />
	</label>
	<label>
		New password
		<input name="next" type="password" autocomplete="new-password" minlength="12" required />
	</label>
	<label>
		Confirm new password
		<input name="confirm" type="password" autocomplete="new-password" minlength="12" required />
	</label>
	<button type="submit">Change password</button>
</form>
