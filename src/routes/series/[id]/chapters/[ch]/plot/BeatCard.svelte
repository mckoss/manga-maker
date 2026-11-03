<script lang="ts">
	import { enhance } from '$app/forms';
	import { AutoSave } from '#lib/autosave.svelte.js';
	import VersionNav from '#lib/components/VersionNav.svelte';
	import Regenerate from '#lib/components/Regenerate.svelte';
	import type { PlotDetail } from '#lib/server/plots.js';

	/**
	 * One beat of the outline: what happens, its pages, and who is in it. The
	 * chapter's cast is everyone in its beats. Edits save when the user leaves
	 * a field, and lock the beat so the AI keeps it.
	 */
	let {
		beat,
		people,
		number
	}: {
		beat: PlotDetail['beats'][number];
		people: PlotDetail['people'];
		number: number;
	} = $props();

	let viewId = $state<number | null>(null);
	let current = $derived(beat.item.versions.find((v) => v.id === beat.item.currentId));
	let shown = $derived(beat.item.versions.find((v) => v.id === viewId) ?? current);
	let editable = $derived(!beat.item.pending && shown !== undefined && shown.id === current?.id);
	let value = $derived.by(() => {
		try {
			const b = JSON.parse(shown?.text ?? '') as {
				text?: string;
				pages?: number;
				characters?: number[];
			};
			return { text: b.text ?? '', pages: b.pages ?? 0, characters: b.characters ?? [] };
		} catch {
			return null;
		}
	});
	let who = $derived(new Set(value?.characters ?? []));
	const save = new AutoSave();
</script>

<article class="beat card wide" class:stale={shown && shown.outOfDate.length}>
	<div class="head">
		<h3><span class="n">{number}</span> {beat.label}</h3>
		<span class="hint">{beat.hint}</span>
	</div>
	<Regenerate
		item={beat.item}
		label={beat.label}
		action="regenerate"
		fields={{ which: `beat:${beat.key}` }}
		placeholder="make the reveal land on a page turn"
		upstream={beat.status === 'upstream'}
	/>
	{#if value}
		<form method="POST" action="?/saveBeat" use:enhance={save.enhance} {@attach save.attach}>
			<input type="hidden" name="key" value={beat.key} />
			<label>
				What happens
				<textarea name="text" rows="4" readonly={!editable}>{value.text}</textarea>
			</label>
			<div class="row">
				<label class="pages">
					Pages
					<input
						name="pages"
						type="number"
						min="0"
						max="60"
						value={value.pages}
						readonly={!editable}
					/>
				</label>
				<fieldset class="who" disabled={!editable}>
					<legend>Who’s in it</legend>
					{#each people as p (p.id)}
						<label class="check">
							<input type="checkbox" name="character" value={p.id} checked={who.has(p.id)} />
							{p.name}
						</label>
					{/each}
					<input
						name="newCharacter"
						class="new"
						placeholder="Add a new character by name"
						aria-label="New character in {beat.label}"
					/>
				</fieldset>
			</div>
			{#if editable}
				<input type="hidden" name="keep" value="on" />
				{#if save.status}<span class="hint" class:error={save.state === 'failed'}
						>{save.status}</span
					>{/if}
			{/if}
		</form>
	{:else if !beat.item.pending}
		<p class="hint">Not written yet.</p>
	{/if}
	{#if current}
		<VersionNav item={beat.item} {shown} label={beat.label} onview={(v) => (viewId = v)} />
	{/if}
</article>

<style>
	.beat {
		display: grid;
		gap: var(--space-2);
	}
	.head {
		display: grid;
		gap: 2px;
	}
	h3 {
		margin: 0;
		font: 700 15px/1.3 var(--font-body);
	}
	.n {
		display: inline-grid;
		place-items: center;
		width: 1.5em;
		height: 1.5em;
		margin-right: 0.25em;
		background: var(--ink);
		color: var(--paper);
		font-size: 12px;
	}
	form {
		display: grid;
		gap: var(--space-2);
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
	}
	.row {
		align-items: start;
		gap: var(--space-4);
	}
	.pages input {
		width: 5em;
	}
	.who {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		justify-content: flex-start;
		gap: var(--space-1) var(--space-3);
		align-items: center;
		margin: 0;
		min-width: 0;
		flex: 1;
	}
	.who .new {
		min-width: 14rem;
		font-size: 13px;
	}
	.beat.stale textarea {
		border: var(--border-stale);
	}
	textarea[readonly],
	input[readonly] {
		color: var(--muted);
	}
</style>
