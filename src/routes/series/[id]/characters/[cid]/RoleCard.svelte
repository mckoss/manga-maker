<script lang="ts">
	import { enhance } from '$app/forms';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import type { ItemView } from '#lib/server/versions.js';

	/** The character's role in the story: the user's choice, with its versions. */
	let {
		item,
		role,
		roles
	}: { item: ItemView; role: string; roles: { value: string; label: string }[] } = $props();

	let viewId = $state<number | null>(null);
	let current = $derived(item.versions.find((v) => v.id === item.currentId));
	let shown = $derived(item.versions.find((v) => v.id === viewId) ?? current);
	let value = $derived(shown?.text ?? role);
</script>

<div class="card wide">
	<form method="POST" action="?/saveText" class="row" use:enhance>
		<input type="hidden" name="kind" value="role" />
		<label>
			Role
			<select name="text" disabled={shown?.id !== current?.id}>
				{#each roles as r (r.value)}
					<option value={r.value} selected={value === r.value}>{r.label}</option>
				{/each}
			</select>
		</label>
		{#if shown?.id === current?.id}
			<button type="submit" class="secondary small">Save role</button>
		{/if}
	</form>
	{#if current}
		<VersionNav {item} {shown} label="Role" lockable={false} onview={(v) => (viewId = v)} />
	{/if}
</div>

<style>
	form {
		align-items: end;
	}
</style>
