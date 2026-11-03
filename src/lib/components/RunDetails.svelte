<script lang="ts">
	import { resolve } from '$app/paths';
	import type { RunRecord } from '#lib/server/runs.js';

	/**
	 * A version's run record, behind a small "Details" disclosure: what the
	 * AI was sent and what came back (text), or the drawing's model, seed,
	 * prompt and backend workflow (images). Fetched when first opened.
	 */
	let { runHash }: { runHash: string } = $props();

	let record = $state<RunRecord | null>(null);
	let failed = $state(false);
	let loading = false;

	async function load(e: Event) {
		if (!(e.currentTarget as HTMLDetailsElement).open || record || loading) return;
		loading = true;
		failed = false;
		try {
			const res = await fetch(resolve('/assets/[hash]', { hash: runHash }));
			if (!res.ok) throw new Error(String(res.status));
			record = (await res.json()) as RunRecord;
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	const pretty = (value: unknown) => JSON.stringify(value, null, 2);
</script>

<details class="run" ontoggle={load}>
	<summary>Details</summary>
	{#if record?.kind === 'text'}
		<p class="line">
			{record.model}{#if Object.keys(record.options).length}
				· {JSON.stringify(record.options)}{/if}
		</p>
		<h4>Messages</h4>
		{#each record.messages as m, i (i)}
			<div class="role">{m.role}</div>
			<pre class="wrap">{m.content}</pre>
		{/each}
		{#each record.attempts as a, i (i)}
			<h4>Attempt {i + 1}</h4>
			{#each a.added ?? [] as m, j (j)}
				<div class="role">{m.role} (sent before this attempt)</div>
				<pre class="wrap">{m.content}</pre>
			{/each}
			<div class="role">reply</div>
			<pre class="wrap">{a.reply}</pre>
			{#if a.error}<p class="error">Could not be used: {a.error}</p>{/if}
		{/each}
		<h4>Parsed</h4>
		<pre>{pretty(record.parsed)}</pre>
	{:else if record?.kind === 'image'}
		<p class="line">
			{record.model} · seed {record.seed}
			{#if record.request.width}· {record.request.width}×{record.request.height}{/if}
			{#if record.request.images}· edit of {record.request.images.length} picture{record.request
					.images.length === 1
					? ''
					: 's'}{/if}
		</p>
		{#if record.request.images?.length}
			<div class="inputs">
				{#each record.request.images as hash, i (i)}
					<a href={resolve('/assets/[hash]', { hash })} target="_blank" rel="noreferrer"
						>image {i + 1}</a
					>
				{/each}
			</div>
		{/if}
		<h4>Prompt</h4>
		<pre class="wrap">{record.request.prompt}</pre>
		{#if record.request.negative}
			<h4>Negative</h4>
			<pre class="wrap">{record.request.negative}</pre>
		{/if}
		<h4>Workflow</h4>
		<pre>{pretty(record.workflow)}</pre>
	{:else if failed}
		<p class="error">The record could not be loaded.</p>
	{:else}
		<p class="line">Loading…</p>
	{/if}
</details>

<style>
	.run {
		/* Its content never widens the page: the pre blocks scroll instead. */
		contain: inline-size;
		width: 100%;
		margin-top: var(--space-1);
		font: 400 12px/1.4 var(--font-body);
		color: var(--tone-60);
	}
	summary {
		width: max-content;
		cursor: pointer;
		font-size: 11px;
		color: var(--tone-60);
	}
	summary:hover {
		color: var(--ink);
	}
	h4 {
		margin: var(--space-2) 0 2px;
		font: 700 11px/1.2 var(--font-body);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--tone-60);
	}
	.line {
		margin: var(--space-1) 0 0;
		overflow-wrap: anywhere;
	}
	.role {
		margin-top: var(--space-1);
		font: 500 11px/1.2 var(--font-mono);
	}
	pre {
		max-width: 100%;
		max-height: 14rem;
		margin: 2px 0 0;
		padding: var(--space-1) var(--space-2);
		overflow: auto;
		background: var(--surface-sunk);
		color: var(--ink);
		font: 400 11px/1.45 var(--font-mono);
	}
	pre.wrap {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.inputs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: 2px;
	}
	.inputs a {
		color: var(--ink);
	}
	.error {
		margin: 2px 0 0;
		color: var(--shu);
	}
</style>
