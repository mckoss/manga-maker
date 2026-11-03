<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Account · Manga Maker</title></svelte:head>

<h1>Account</h1>
<p>Signed in as <strong>{page.data.user?.username}</strong>.</p>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.message}<p class="ok" role="status">{form.message}</p>{/if}

<form method="POST" action="?/imageModel" class="card">
	<h2>Default image model</h2>
	<label>
		Image model
		<select name="imageModel">
			{#each data.imageModels as m (m.value)}
				<option value={m.value} selected={data.imageModel === m.value}>{m.label} — {m.edits}</option
				>
			{/each}
		</select>
	</label>
	<p class="hint">
		Draws your pictures unless a series chooses its own (in its settings) or you choose one next to
		a picture's Regenerate button.
	</p>
	<button type="submit">Save</button>
</form>

<form method="POST" action="?/password" class="card">
	<h2>Change password</h2>
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
