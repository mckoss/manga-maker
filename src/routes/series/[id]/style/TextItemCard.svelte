<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import type { ItemView } from '#lib/server/versions.js';
	import { outOfDateText } from './labels.js';

	/**
	 * One versioned piece of text (the description, the style prompt, a
	 * scene): edit it, browse its versions, and ask the AI for a new one.
	 */
	let {
		item,
		label,
		kind,
		key = '',
		lines = 2,
		placeholder = '',
		notesBy = '',
		regenerate
	}: {
		item: ItemView;
		label: string;
		kind: string;
		key?: string;
		lines?: number;
		placeholder?: string;
		/** Show the AI's notes on the version, credited to this role. */
		notesBy?: string;
		/** Ask the AI for a new version: the form action and the button wording. */
		regenerate?: { action: string; which?: string; label: string; placeholder: string };
	} = $props();

	let viewId = $state<number | null>(null);
	let current = $derived(item.versions.find((v) => v.id === item.currentId));
	let shown = $derived(item.versions.find((v) => v.id === viewId) ?? current);
	let editable = $derived(!item.locked && shown?.id === current?.id);
	let id = $derived(`${kind}-${key || 'main'}`);

	/** Submit without clearing what the user typed. */
	const keep: SubmitFunction =
		() =>
		async ({ update }) =>
			update({ reset: false });
</script>

<div class="card wide item" class:stale={shown && shown.outOfDate.length}>
	<div class="head">
		<label for={id}>{label}</label>
		{#if item.pending}
			<span class="hint"><span class="spinner"></span> The AI is writing…</span>
		{:else if !current}
			<span class="badge muted">Not written yet</span>
		{/if}
		{#if shown?.outOfDate.length}<span class="badge warn">Out of date</span>{/if}
	</div>
	{#if shown?.outOfDate.length}
		<p class="why">{outOfDateText(shown.outOfDate)}</p>
	{/if}
	{#if item.error && !item.pending}
		<p class="error">The last attempt failed: {item.error}</p>
	{/if}
	{#if notesBy && shown?.notes}
		<p class="mentor"><strong>{notesBy}:</strong> {shown.notes}</p>
	{/if}
	<form method="POST" action="?/saveText" use:enhance={keep}>
		<input type="hidden" name="kind" value={kind} />
		<input type="hidden" name="key" value={key} />
		<textarea
			{id}
			name="text"
			rows={lines}
			readonly={!editable}
			{placeholder}
			value={shown?.text ?? ''}></textarea>
		{#if editable}
			<button type="submit" class="secondary small">Save {label.toLowerCase()}</button>
		{:else if item.locked}
			<span class="hint">Locked. Unlock it to change it.</span>
		{/if}
	</form>
	<VersionNav {item} {shown} {label} lockable={!!regenerate} onview={(v) => (viewId = v)} />
	{#if regenerate && !item.locked}
		<details class="regen">
			<summary>{regenerate.label}…</summary>
			<form method="POST" action="?/{regenerate.action}" use:enhance>
				{#if regenerate.which}<input type="hidden" name="which" value={regenerate.which} />{/if}
				<label>
					Guidance for the AI (optional)
					<textarea name="guidance" rows="2" placeholder={regenerate.placeholder}></textarea>
				</label>
				<button type="submit" disabled={item.pending}>{regenerate.label}</button>
			</form>
		</details>
	{/if}
</div>

<style>
	.item {
		display: grid;
		gap: 0.4rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.head label {
		font-weight: 600;
		margin: 0;
	}
	.why {
		margin: 0;
		font-size: 0.85rem;
		color: var(--warn);
	}
	.mentor {
		margin: 0;
	}
	form {
		display: grid;
		gap: 0.4rem;
		justify-items: start;
	}
	textarea {
		width: 100%;
	}
	textarea[readonly] {
		color: var(--muted);
	}
	.regen form {
		margin-top: 0.4rem;
	}
	.regen label {
		width: 100%;
	}
</style>
