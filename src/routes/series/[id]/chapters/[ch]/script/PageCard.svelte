<script lang="ts">
	import { enhance } from '$app/forms';
	import { AutoSave } from '#lib/autosave.svelte.js';
	import type { PageView, ScriptDetail } from '#lib/script.js';
	import PanelCard from './PanelCard.svelte';

	/**
	 * One page of the script: what it is for, whether a reveal lands on its
	 * page turn, and its panels in reading order. Edits save when the user
	 * leaves a field.
	 */
	let {
		page,
		people,
		places,
		beats,
		first,
		last
	}: {
		page: PageView;
		people: ScriptDetail['people'];
		places: ScriptDetail['places'];
		/** For a page whose beat left the outline: the beats it can move to. */
		beats?: { key: string; label: string }[];
		first: boolean;
		last: boolean;
	} = $props();

	const save = new AutoSave();
	const move = new AutoSave();
	let confirming = $state(false);
	let lastPanel = $derived(page.panels.at(-1)?.id ?? '');
</script>

<article class="page card wide" class:stale={page.beatChanged} aria-label="Page {page.number}">
	<div class="head">
		<h3>
			Page {page.number}
			{#if page.turn}<span class="badge shu">Page turn</span>{/if}
		</h3>
		<div class="tools">
			<form method="POST" action="?/movePage" use:enhance>
				<input type="hidden" name="pageId" value={page.id} />
				<button
					type="submit"
					name="dir"
					value="up"
					class="secondary small"
					disabled={first}
					aria-label="Move page {page.number} earlier">↑</button
				>
				<button
					type="submit"
					name="dir"
					value="down"
					class="secondary small"
					disabled={last}
					aria-label="Move page {page.number} later">↓</button
				>
			</form>
			{#if confirming}
				<form method="POST" action="?/deletePage" use:enhance class="confirm">
					<input type="hidden" name="pageId" value={page.id} />
					<span class="hint">Delete this page and its panels?</span>
					<button type="submit" class="danger small">Delete page {page.number}</button>
					<button type="button" class="secondary small" onclick={() => (confirming = false)}
						>Keep it</button
					>
				</form>
			{:else if page.panels.length}
				<button
					type="button"
					class="secondary small"
					aria-label="Delete page {page.number}"
					onclick={() => (confirming = true)}>Delete</button
				>
			{:else}
				<form method="POST" action="?/deletePage" use:enhance>
					<input type="hidden" name="pageId" value={page.id} />
					<button type="submit" class="secondary small" aria-label="Delete page {page.number}"
						>Delete</button
					>
				</form>
			{/if}
		</div>
	</div>

	{#if page.beatChanged}
		<div class="changed" role="status">
			<p>
				<strong>Beat changed.</strong> The plot’s beat was edited since this page was laid out. Check
				that the page still fits.
			</p>
			<form method="POST" action="?/checkPage" use:enhance>
				<input type="hidden" name="pageId" value={page.id} />
				<button type="submit" class="secondary small">I’ve checked it</button>
			</form>
		</div>
	{/if}
	{#if page.pending}<p class="hint"><span class="spinner"></span> Filling in this page…</p>{/if}
	{#if page.error}<p class="error" role="alert">{page.error}</p>{/if}

	{#if beats}
		<form method="POST" action="?/savePage" use:enhance={move.enhance} {@attach move.attach}>
			<input type="hidden" name="pageId" value={page.id} />
			<label>
				Move to beat
				<select name="beat" value="">
					<option value="" disabled>— choose a beat —</option>
					{#each beats as b (b.key)}<option value={b.key}>{b.label}</option>{/each}
				</select>
			</label>
		</form>
	{/if}

	<form
		method="POST"
		action="?/savePage"
		class="fields"
		use:enhance={save.enhance}
		{@attach save.attach}
	>
		<input type="hidden" name="pageId" value={page.id} />
		<label>
			What this page is for
			<input
				name="purpose"
				value={page.purpose}
				maxlength="500"
				placeholder="The one moment this page is about"
			/>
		</label>
		<input type="hidden" name="hasTurn" value="on" />
		<label class="check">
			<input type="checkbox" name="turn" checked={page.turn} />
			A reveal lands on this page turn
		</label>
		{#if save.status}<span class="hint" class:error={save.state === 'failed'}>{save.status}</span
			>{/if}
	</form>

	{#each page.panels as panel, i (panel.id)}
		<PanelCard
			{panel}
			pageId={page.id}
			{people}
			{places}
			first={i === 0}
			last={i === page.panels.length - 1}
		/>
	{:else}
		<p class="hint">No panels yet. Add one for each picture on the page, in reading order.</p>
	{/each}

	<div class="row actions">
		<form method="POST" action="?/addPanel" use:enhance>
			<input type="hidden" name="pageId" value={page.id} />
			<input type="hidden" name="after" value={lastPanel} />
			<button type="submit" class="secondary small" aria-label="Add a panel to page {page.number}"
				>Add a panel</button
			>
		</form>
		{#if !beats && !page.pending}
			<form method="POST" action="?/helpFill" use:enhance>
				<input type="hidden" name="pageId" value={page.id} />
				<button
					type="submit"
					class="secondary small"
					aria-label="Help me fill in page {page.number}"
					title="The AI drafts only the blank fields: shots, who, where, what we see, and a cue for the words. It never changes what you wrote, and never writes the words."
					>Help me fill in the blanks</button
				>
			</form>
		{/if}
	</div>
</article>

<style>
	.actions {
		gap: var(--space-2);
		justify-content: flex-start;
	}
	.page {
		display: grid;
		gap: var(--space-3);
		margin: 0;
	}
	.page.stale {
		border: var(--border-stale);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
	}
	h3 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font: 700 16px/1.3 var(--font-body);
	}
	.tools,
	.tools form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		margin: 0;
	}
	.confirm .hint {
		margin: 0 var(--space-1);
	}
	.changed {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1.5px dashed var(--warn);
		background: var(--surface-page);
	}
	.changed p {
		margin: 0;
	}
	.changed strong {
		color: var(--warn);
	}
	.fields {
		display: grid;
		gap: var(--space-2);
	}
	form {
		margin: 0;
	}
</style>
