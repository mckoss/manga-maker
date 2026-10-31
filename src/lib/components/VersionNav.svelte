<script lang="ts">
	import { enhance } from '$app/forms';
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
		onview
	}: {
		item: ItemView;
		shown: VersionView | undefined;
		label: string;
		/** False for the user's own inputs, which are never regenerated. */
		lockable?: boolean;
		onview: (id: number) => void;
	} = $props();

	let index = $derived(shown ? item.versions.findIndex((v) => v.id === shown.id) : -1);
	let isCurrent = $derived(shown !== undefined && shown.id === item.currentId);

	const ORIGIN: Record<string, string> = {
		ai: 'by the AI',
		user: 'edited by you',
		import: 'from before versions were kept'
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
		{#if item.versions.length > 1}
			<span class="pager">
				<button
					type="button"
					class="secondary small"
					disabled={index <= 0}
					onclick={() => step(-1)}
					aria-label="Older version of {label}">‹</button
				>
				<span class="count">{index + 1} of {item.versions.length}</span>
				<button
					type="button"
					class="secondary small"
					disabled={index >= item.versions.length - 1}
					onclick={() => step(1)}
					aria-label="Newer version of {label}">›</button
				>
			</span>
		{/if}
		<span class="meta">
			{#if isCurrent}<strong>in use</strong>{:else}<em>not in use</em>{/if}
			· {ORIGIN[shown.origin] ?? shown.origin}
		</span>
		{#if item.locked}<span class="badge lock">Locked</span>{/if}
	</div>
	<div class="actions">
		{#if !isCurrent && !item.locked}
			<form method="POST" action="?/useVersion" use:enhance>
				<input type="hidden" name="versionId" value={shown.id} />
				<button type="submit" class="secondary small">Use this version</button>
				<button type="submit" class="secondary small" name="lock" value="on">Use and lock</button>
			</form>
		{/if}
		{#if isCurrent && lockable}
			<form method="POST" action="?/lock" use:enhance>
				<input type="hidden" name="itemId" value={item.id} />
				<input type="hidden" name="locked" value={item.locked ? '' : 'on'} />
				<button type="submit" class="secondary small">{item.locked ? 'Unlock' : 'Lock'}</button>
			</form>
		{/if}
		<form method="POST" action="?/deleteVersion" use:enhance onsubmit={confirmLocked}>
			<input type="hidden" name="versionId" value={shown.id} />
			<button type="submit" class="secondary small" aria-label="Delete this version of {label}"
				>Delete</button
			>
		</form>
		{#if item.versions.length > 1}
			<form method="POST" action="?/deleteOthers" use:enhance onsubmit={confirmOthers}>
				<input type="hidden" name="itemId" value={item.id} />
				<button type="submit" class="secondary small">Delete older</button>
			</form>
		{/if}
	</div>
{/if}

<style>
	.nav,
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		font-size: 0.85rem;
	}
	.actions {
		margin-top: 0.35rem;
	}
	.actions form {
		display: flex;
		gap: 0.4rem;
		margin: 0;
	}
	.pager {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.count {
		min-width: 3.5rem;
		text-align: center;
	}
	.meta {
		color: var(--muted);
	}
	.lock {
		font-size: 0.75rem;
	}
</style>
