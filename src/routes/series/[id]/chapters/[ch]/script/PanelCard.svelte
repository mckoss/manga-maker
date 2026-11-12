<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import { AutoSave } from '#lib/autosave.svelte.js';
	import {
		newId,
		SHOTS,
		TEXT_KINDS,
		type PanelView,
		type ScriptDetail,
		type StagingField,
		type TextBlock,
		type TextKind
	} from '#lib/script.js';

	/**
	 * One panel: its staging (shot, where, who, what we see) and its words.
	 * The words are always the writer's; a cue only prompts them. Each form
	 * saves when the user leaves a field.
	 */
	let {
		panel,
		pageId,
		people,
		places,
		first,
		last
	}: {
		panel: PanelView;
		pageId: string;
		people: ScriptDetail['people'];
		places: ScriptDetail['places'];
		first: boolean;
		last: boolean;
	} = $props();

	const staging = new AutoSave();
	const wordsSave = new AutoSave();
	let wordsForm = $state<HTMLFormElement>();

	let p = $derived(panel.panel);
	let who = $derived(new Set(p.characters));
	let aiDraft = $derived((f: StagingField) => p.ai.includes(f));
	let shotHint = $derived(SHOTS.find((s) => s.key === p.shot)?.hint ?? '');

	// The words being edited: the saved blocks, then blocks added here that
	// have no words yet (the server keeps only blocks with text).
	let drafts = $state<TextBlock[]>([]);
	let removed = $state<string[]>([]);
	let savedIds = $derived(new Set(panel.words.map((b) => b.id)));
	let blocks = $derived(
		[...panel.words, ...drafts.filter((d) => !savedIds.has(d.id))].filter(
			(b) => !removed.includes(b.id)
		)
	);

	const KIND_LABEL = Object.fromEntries(TEXT_KINDS.map((k) => [k.key, k.label])) as Record<
		TextKind,
		string
	>;
	const spoken = (kind: TextKind) => kind === 'speech' || kind === 'thought';
	const PLACEHOLDER: Record<TextKind, string> = {
		speech: 'What do they say?',
		thought: 'What do they think, and keep to themselves?',
		caption: 'Narration: where, when, or what the reader needs to know',
		sfx: 'The sound, as it looks on the page: CRASH, fwoosh…'
	};
	function placeholder(b: TextBlock) {
		return panel.panel.cue && !b.text && spoken(b.kind)
			? `Cue: ${panel.panel.cue}`
			: PLACEHOLDER[b.kind];
	}

	function addBlock(kind: TextKind) {
		const speaker = spoken(kind) && p.characters.length === 1 ? p.characters[0] : null;
		drafts.push({ id: newId(), kind, speaker, text: '' });
	}
	async function removeBlock(id: string) {
		const saved = savedIds.has(id);
		removed.push(id);
		drafts = drafts.filter((d) => d.id !== id);
		if (!saved) return;
		await tick();
		wordsForm?.requestSubmit();
	}
	/** A draft's kind shows at once; a saved block's kind shows when the save comes back. */
	function setKind(id: string, kind: TextKind) {
		const d = drafts.find((x) => x.id === id);
		if (d) {
			d.kind = kind;
			if (!spoken(kind)) d.speaker = null;
		}
	}
	let name = $derived(`Panel ${panel.number}`);
</script>

<article class="panel" class:key={panel.isKey} aria-label={name}>
	<div class="head">
		<h4>{name}</h4>
		<form method="POST" action="?/savePage" use:enhance>
			<input type="hidden" name="pageId" value={pageId} />
			<input type="hidden" name="keyPanel" value={panel.isKey ? '' : panel.id} />
			<button
				type="submit"
				class="secondary small"
				class:on={panel.isKey}
				aria-pressed={panel.isKey}
				title="The panel this page is about">★ Key panel</button
			>
		</form>
		<div class="tools">
			<form method="POST" action="?/movePanel" use:enhance>
				<input type="hidden" name="panelId" value={panel.id} />
				<button
					type="submit"
					name="dir"
					value="up"
					class="secondary small"
					disabled={first}
					aria-label="Move {name} earlier">↑</button
				>
				<button
					type="submit"
					name="dir"
					value="down"
					class="secondary small"
					disabled={last}
					aria-label="Move {name} later">↓</button
				>
			</form>
			<form method="POST" action="?/deletePanel" use:enhance>
				<input type="hidden" name="panelId" value={panel.id} />
				<button type="submit" class="secondary small" aria-label="Delete {name}">Delete</button>
			</form>
		</div>
	</div>

	<form
		method="POST"
		action="?/savePanel"
		class="staging"
		use:enhance={staging.enhance}
		{@attach staging.attach}
	>
		<input type="hidden" name="panelId" value={panel.id} />
		<div class="row">
			<label>
				<span
					>Shot {#if aiDraft('shot')}<span class="badge muted">AI draft</span>{/if}</span
				>
				<select name="shot" value={p.shot}>
					<option value="">— choose —</option>
					{#each SHOTS as s (s.key)}<option value={s.key} title={s.hint}>{s.label}</option>{/each}
				</select>
			</label>
			<label>
				<span
					>Where {#if aiDraft('location')}<span class="badge muted">AI draft</span>{/if}</span
				>
				<select name="location" value={p.location ? String(p.location) : ''}>
					<option value="">— none —</option>
					{#each places as place (place.id)}<option value={String(place.id)}>{place.name}</option
						>{/each}
				</select>
			</label>
		</div>
		{#if shotHint}<p class="hint shot-hint">{shotHint}</p>{/if}
		<input type="hidden" name="hasCharacters" value="on" />
		<fieldset class="who">
			<legend
				>Who’s in it {#if aiDraft('characters')}<span class="badge muted">AI draft</span
					>{/if}</legend
			>
			{#each people as person (person.id)}
				<label class="check">
					<input type="checkbox" name="character" value={person.id} checked={who.has(person.id)} />
					{person.name}
				</label>
			{:else}
				<span class="hint">No characters in the series yet.</span>
			{/each}
		</fieldset>
		<label>
			<span
				>What we see {#if aiDraft('action')}<span class="badge muted">AI draft</span>{/if}</span
			>
			<textarea
				name="action"
				rows="2"
				maxlength="2000"
				placeholder="What the reader sees in this frame: who does what, where">{p.action}</textarea
			>
		</label>
		{#if staging.status}<span class="hint" class:error={staging.state === 'failed'}
				>{staging.status}</span
			>{/if}
	</form>

	<form
		method="POST"
		action="?/saveWords"
		class="words"
		bind:this={wordsForm}
		use:enhance={wordsSave.enhance}
		{@attach wordsSave.attach}
		aria-label="Words in {name}"
	>
		<input type="hidden" name="panelId" value={panel.id} />
		<h5>Words</h5>
		{#if p.cue && !blocks.length}
			<p class="hint cue">Cue: {p.cue}</p>
		{/if}
		{#each blocks as b, i (b.id)}
			{@const label = `${KIND_LABEL[b.kind]} ${i + 1}`}
			<div class="block {b.kind}" role="group" aria-label={label}>
				<input type="hidden" name="blockId" value={b.id} />
				<div class="block-head">
					<select
						name="kind"
						aria-label="Kind of {label}"
						value={b.kind}
						onchange={(e) => setKind(b.id, e.currentTarget.value as TextKind)}
					>
						{#each TEXT_KINDS as k (k.key)}<option value={k.key}>{k.label}</option>{/each}
					</select>
					{#if spoken(b.kind)}
						<select
							name="speaker"
							aria-label="Speaker of {label}"
							value={b.speaker ? String(b.speaker) : ''}
						>
							<option value="">— who? —</option>
							{#each people as person (person.id)}<option value={String(person.id)}
									>{person.name}</option
								>{/each}
						</select>
					{:else}
						<input type="hidden" name="speaker" value="" />
					{/if}
					<button
						type="button"
						class="link remove"
						aria-label="Remove {label}"
						onclick={() => removeBlock(b.id)}>Remove</button
					>
				</div>
				<textarea
					name="text"
					rows="2"
					maxlength="1000"
					aria-label="Text of {label}"
					placeholder={placeholder(b)}>{b.text}</textarea
				>
			</div>
		{/each}
		<div class="add">
			<button type="button" class="secondary small" onclick={() => addBlock('speech')}
				>+ Speech</button
			>
			<button type="button" class="secondary small" onclick={() => addBlock('caption')}
				>+ Caption</button
			>
			<button type="button" class="secondary small" onclick={() => addBlock('thought')}
				>+ Thought</button
			>
			<button type="button" class="secondary small" onclick={() => addBlock('sfx')}>+ SFX</button>
			{#if wordsSave.status}<span class="hint" class:error={wordsSave.state === 'failed'}
					>{wordsSave.status}</span
				>{/if}
		</div>
	</form>
</article>

<style>
	.panel {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border: var(--border-control);
		background: var(--surface-panel);
	}
	.panel.key {
		border-color: var(--shu);
		box-shadow: var(--shadow-shu);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	h4 {
		margin: 0;
		font: 700 14px/1.3 var(--font-body);
	}
	.head .tools {
		margin-left: auto;
	}
	.tools,
	form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
	}
	button.on {
		background: var(--shu);
		border-color: var(--shu);
		color: var(--paper);
	}
	button.on:hover:not(:disabled) {
		color: var(--paper);
	}
	.staging,
	.words {
		display: grid;
		gap: var(--space-2);
	}
	.staging .row {
		margin: 0;
		align-items: start;
	}
	label > span {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.shot-hint,
	.cue {
		margin: 0;
	}
	.who {
		flex-direction: row;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		padding-block: var(--space-2);
	}
	textarea {
		width: 100%;
	}
	.words {
		padding-top: var(--space-2);
		border-top: var(--border-rule-1);
	}
	h5 {
		margin: 0;
		font: var(--type-label);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--tone-60);
	}
	.block {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-2);
		border-left: 4px solid var(--tone-40);
	}
	.block.speech textarea,
	.block.thought textarea {
		border-radius: var(--radius-balloon);
	}
	.block.thought textarea {
		border-style: dashed;
	}
	.block.caption {
		border-left-color: var(--ink);
	}
	.block.sfx {
		border-left-color: var(--shu);
	}
	.block.sfx textarea {
		font-weight: 700;
	}
	.block-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.block-head select {
		padding-block: 4px;
		font-size: 13px;
	}
	.remove {
		margin-left: auto;
		font-size: 13px;
	}
	.add {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}
	.add .hint {
		margin-left: var(--space-2);
	}
</style>
