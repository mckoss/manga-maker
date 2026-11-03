<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '#lib/components/Icon.svelte';
	import { modelLabel } from '#lib/models.js';
	import type { ItemView, VersionView } from '#lib/server/versions.js';

	/**
	 * Browse an item's versions and act on them: go back to one (and lock it
	 * in), lock or unlock the item, delete a version or all but the current
	 * one. Posts to the page's useVersion, lock, deleteVersion and
	 * deleteOthers actions.
	 */
	let {
		item,
		shown,
		label,
		lockable = true,
		scope = '',
		onview
	}: {
		item: ItemView;
		shown: VersionView | undefined;
		label: string;
		/** False for the user's own inputs, which are never regenerated. */
		lockable?: boolean;
		/** Sent with each action, for items outside the page's own scope ("series"). */
		scope?: string;
		onview: (id: number) => void;
	} = $props();

	let index = $derived(shown ? item.versions.findIndex((v) => v.id === shown.id) : -1);
	let isCurrent = $derived(shown !== undefined && shown.id === item.currentId);

	const ORIGIN: Record<string, string> = {
		ai: 'generated',
		user: 'edited by you',
		import: 'from before versions were saved'
	};

	const step = (delta: number) => {
		const next = item.versions[index + delta];
		if (next) onview(next.id);
	};

	const confirmLocked = (e: SubmitEvent) => {
		if (item.locked && !confirm(`${label} is locked. Delete this version anyway?`)) {
			e.preventDefault();
		}
	};

	const confirmOthers = (e: SubmitEvent) => {
		const n = item.versions.length - 1;
		if (
			!confirm(`Delete ${n} older version${n === 1 ? '' : 's'} of ${label}? This can't be undone.`)
		) {
			e.preventDefault();
		}
	};
</script>

{#if shown}
	<div class="nav" role="group" aria-label="{label} versions">
		{#if lockable}
			<form method="POST" action="?/lock" use:enhance class="padlock">
				{#if scope}<input type="hidden" name="scope" value={scope} />{/if}
				<input type="hidden" name="itemId" value={item.id} />
				<input type="hidden" name="locked" value={item.locked ? '' : 'on'} />
				<button
					type="submit"
					class:locked={item.locked}
					aria-label={item.locked ? `Unlock ${label}` : `Lock ${label}`}
					aria-pressed={item.locked}
					title={item.locked
						? 'Locked: it won’t be regenerated. Click to unlock.'
						: 'Unlocked: it can be regenerated. Click to lock it.'}
				>
					<Icon
						name={item.locked ? 'lock' : 'lock-open'}
						size={15}
						stroke={item.locked ? 2.25 : 2}
					/>
					{#if item.locked}<span>Locked</span>{/if}
				</button>
			</form>
		{:else if item.locked}
			<span class="badge lock">Locked</span>
		{/if}
		<span class="pager">
			{#if item.versions.length > 1}
				<button
					type="button"
					class="secondary small"
					disabled={index <= 0}
					onclick={() => step(-1)}
					aria-label="Older version of {label}">‹</button
				>
			{/if}
			<span class="count">Version {index + 1} of {item.versions.length}</span>
			{#if item.versions.length > 1}
				<button
					type="button"
					class="secondary small"
					disabled={index >= item.versions.length - 1}
					onclick={() => step(1)}
					aria-label="Newer version of {label}">›</button
				>
			{/if}
		</span>
		<span class="meta">
			{#if isCurrent}<strong>Selected</strong>{:else}<em>not selected</em>{/if}
			· {ORIGIN[shown.origin] ?? shown.origin}
			{#if shown.model}· <span class="model" title="The model that made it"
					>{modelLabel(shown.model)}</span
				>{/if}
			{#if shown.guidance}· <span class="amended">amended: {shown.guidance}</span>{/if}
		</span>
	</div>
	<div class="actions">
		{#if !isCurrent}
			<form method="POST" action="?/useVersion" use:enhance>
				{#if scope}<input type="hidden" name="scope" value={scope} />{/if}
				<input type="hidden" name="versionId" value={shown.id} />
				<button type="submit" class="secondary small">Select this version</button>
				{#if lockable && !item.locked}
					<button type="submit" class="secondary small" name="lock" value="on"
						>Select and lock</button
					>
				{/if}
			</form>
		{/if}
		<form method="POST" action="?/deleteVersion" use:enhance onsubmit={confirmLocked}>
			{#if scope}<input type="hidden" name="scope" value={scope} />{/if}
			<input type="hidden" name="versionId" value={shown.id} />
			<button type="submit" class="secondary small" aria-label="Delete this version of {label}"
				>Delete</button
			>
		</form>
		{#if item.versions.length > 1}
			<form method="POST" action="?/deleteOthers" use:enhance onsubmit={confirmOthers}>
				{#if scope}<input type="hidden" name="scope" value={scope} />{/if}
				<input type="hidden" name="itemId" value={item.id} />
				<button type="submit" class="secondary small">Delete older</button>
			</form>
		{/if}
	</div>
{/if}

<style>
	/* A low-profile control row: the element it controls carries the weight. */
	.nav,
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		font: 400 12px/1.4 var(--font-body);
	}
	.actions {
		margin-top: var(--space-1);
	}
	.actions form {
		display: flex;
		gap: var(--space-3);
		margin: 0;
	}
	.padlock {
		display: contents;
	}
	.padlock button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 4px;
		border: none;
		background: transparent;
		color: var(--tone-60);
		font: 700 11px/1 var(--font-body);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.padlock button.locked {
		color: var(--ink);
	}
	.padlock button:hover:not(:disabled) {
		transform: none;
		box-shadow: none;
		background: var(--surface-sunk);
		color: var(--ink);
	}
	.pager {
		display: inline-flex;
		align-items: center;
	}
	.pager button {
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--tone-60);
		font: 400 18px/1 var(--font-body);
	}
	.pager button:hover:not(:disabled) {
		transform: none;
		box-shadow: none;
		background: var(--surface-sunk);
		color: var(--ink);
	}
	.pager button:disabled {
		color: var(--tone-20);
		opacity: 1;
	}
	.count {
		min-width: 6.5rem;
		text-align: center;
		font: 500 11px/1 var(--font-mono);
		color: var(--ink);
	}
	.meta {
		color: var(--tone-60);
	}
	.amended {
		font-style: italic;
	}
	.meta em {
		font-style: normal;
		color: var(--shu);
	}
	.actions button {
		padding: 0;
		border: none;
		background: none;
		color: var(--ink);
		font: 700 12px var(--font-body);
		text-decoration: underline;
		text-decoration-color: var(--shu);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
	.actions button:hover:not(:disabled) {
		transform: none;
		box-shadow: none;
		color: var(--shu);
	}
	.actions form[action*='delete'] button {
		font-weight: 400;
		text-decoration-color: var(--tone-40);
	}
</style>
