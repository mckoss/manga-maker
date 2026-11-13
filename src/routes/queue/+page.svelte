<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let queue = $derived(data.queue);
	type Job = (typeof queue.recent)[number];

	// Reload every two seconds while anything waits or runs, every five when idle.
	$effect(() => {
		const timer = setInterval(() => invalidateAll(), queue.busy ? 2000 : 5000);
		return () => clearInterval(timer);
	});

	// A clock for the running timers, ticking every second.
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	/** Keep the form as it is after a command (the reload shows the result). */
	const keep: SubmitFunction =
		() =>
		async ({ update }) =>
			update({ reset: false });

	/** "45s", "1m 23s", "2h 5m". */
	function span(ms: number): string {
		const s = Math.max(0, Math.round(ms / 1000));
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ${s % 60}s`;
		return `${Math.floor(m / 60)}h ${m % 60}m`;
	}

	/** "just now", "3 min ago", "2 h ago", "4 days ago". */
	function ago(at: Date, clock: number): string {
		const m = Math.floor((clock - at.getTime()) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m} min ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} h ago`;
		const d = Math.floor(h / 24);
		return `${d} day${d === 1 ? '' : 's'} ago`;
	}

	function waitingStatus(job: Job): string {
		if (job.status === 'paused') return 'Paused';
		if (job.waitingOn.length)
			return `Waiting for ${job.waitingOn.map((id) => `#${id}`).join(', ')}`;
		return 'Waiting';
	}

	const RESULT = {
		done: { text: 'Done', tone: 'ok' },
		failed: { text: 'Failed', tone: 'shu' },
		canceled: { text: 'Stopped', tone: 'muted' }
	} as Record<string, { text: string; tone: string }>;

	let modelLabels = $derived(new Map(queue.models.map((m) => [m.id, m.label])));
</script>

<svelte:head><title>Queue · Manga Maker</title></svelte:head>

<h1>Queue</h1>
<p class="hint">
	Writing and drawing run side by side, one job at a time each. Pause or stop anything that is
	taking too long; a running job you pause starts over from the beginning when you resume it.
</p>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

{#snippet what(job: Job)}
	{#if job.what}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={job.what.href}>{job.what.title}</a>
	{/if}
{/snippet}

{#snippet jobForm(action: string, job: Job, text: string, cls = 'secondary small')}
	<form method="POST" action="?/{action}" use:enhance={keep}>
		<input type="hidden" name="id" value={job.id} />
		<button type="submit" class={cls} aria-label="{text} job #{job.id}">{text}</button>
	</form>
{/snippet}

{#each queue.lanes as lane (lane.lane)}
	{@const mineWaiting = lane.waiting.some((j) => j.mine)}
	<section aria-label={lane.label}>
		<div class="title-row">
			<h2>{lane.label}</h2>
			{#if lane.paused}<span class="badge warn">Paused</span>{/if}
			<div class="tools">
				{#if queue.isAdmin}
					<form method="POST" action="?/setLane" use:enhance={keep}>
						<input type="hidden" name="lane" value={lane.lane} />
						<input type="hidden" name="paused" value={lane.paused ? 'false' : 'true'} />
						<button type="submit" class="secondary small">
							{lane.paused ? 'Resume lane' : 'Pause lane'}
						</button>
					</form>
				{/if}
				{#if mineWaiting}
					<form method="POST" action="?/clearLane" use:enhance={keep}>
						<input type="hidden" name="lane" value={lane.lane} />
						<button type="submit" class="danger small">Stop all waiting</button>
					</form>
				{/if}
			</div>
		</div>

		{#if lane.running}
			{@const job = lane.running}
			<article class="card running" aria-label="Running: {job.label}">
				<div class="head">
					<span class="badge shu">Running</span>
					<strong>{job.label}</strong>
					{#if job.owner}<span class="hint">({job.owner})</span>{/if}
				</div>
				{#if job.mine}
					<p class="meta">
						{@render what(job)}
						{#if job.startedAt}<span>running for {span(now - job.startedAt.getTime())}</span>{/if}
						{#if job.model}<span>{modelLabels.get(job.model) ?? job.model}</span>{/if}
					</p>
					<div class="actions">
						{@render jobForm('pause', job, 'Pause')}
						{@render jobForm('stop', job, 'Stop', 'danger small')}
					</div>
				{:else if job.startedAt}
					<p class="meta"><span>running for {span(now - job.startedAt.getTime())}</span></p>
				{/if}
			</article>
		{/if}

		{#if lane.waiting.length}
			<ol class="waiting" aria-label="Waiting in {lane.label}">
				{#each lane.waiting as job, i (job.id)}
					<li class="card" aria-label="#{i + 1}: {job.label}">
						<span class="pos" aria-hidden="true">{i + 1}</span>
						<div class="body">
							<div class="head">
								<strong>{job.label}</strong>
								{#if job.owner}<span class="hint">({job.owner})</span>{/if}
								<span class="badge {job.status === 'paused' ? 'warn' : 'muted'}"
									>{waitingStatus(job)}</span
								>
							</div>
							<p class="meta">
								{#if job.mine}{@render what(job)}{/if}
								<span>waited {span(now - job.createdAt.getTime())}</span>
							</p>
							{#if job.mine}
								<div class="actions">
									{#if job.status === 'paused'}
										{@render jobForm('resume', job, 'Resume')}
									{:else}
										{@render jobForm('pause', job, 'Pause')}
									{/if}
									{@render jobForm('stop', job, 'Stop', 'danger small')}
									{#if job.lane === 'image' && job.model}
										<form method="POST" action="?/setModel" use:enhance={keep}>
											<input type="hidden" name="id" value={job.id} />
											<select
												name="model"
												aria-label="Image model for job #{job.id}"
												value={job.model}
												onchange={(e) => e.currentTarget.form?.requestSubmit()}
											>
												{#each queue.models as m (m.id)}
													<option value={m.id}>{m.label}</option>
												{/each}
											</select>
										</form>
									{/if}
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="hint">Nothing waiting.</p>
		{/if}
	</section>
{/each}

<section aria-label="Recent">
	<h2>Recent</h2>
	{#if queue.recent.length}
		<ul class="recent">
			{#each queue.recent as job (job.id)}
				{@const r = RESULT[job.status] ?? { text: job.status, tone: 'muted' }}
				<li aria-label="{r.text}: {job.label}">
					<span class="badge {r.tone}">{r.text}</span>
					<strong>{job.label}</strong>
					{#if job.owner}<span class="hint">({job.owner})</span>{/if}
					{@render what(job)}
					{#if job.finishedAt}
						<span class="hint">
							{ago(job.finishedAt, now)}
							{#if job.startedAt}· took {span(
									job.finishedAt.getTime() - job.startedAt.getTime()
								)}{/if}
						</span>
					{/if}
					{#if job.status === 'failed' && job.error}<p class="error">{job.error}</p>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="hint">Nothing has finished yet.</p>
	{/if}
</section>

<style>
	.tools {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-left: auto;
	}
	.head,
	.meta,
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.meta {
		margin: var(--space-2) 0 0;
		font-size: 14px;
		color: var(--text-muted);
	}
	.actions {
		margin-top: var(--space-2);
	}
	.running {
		margin-bottom: var(--space-3);
	}
	.waiting,
	.recent {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.waiting li {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}
	.pos {
		font: 700 18px/1.4 var(--font-mono);
		color: var(--tone-60);
		min-width: 1.5em;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.recent li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: var(--border-rule-1);
	}
	.recent .error {
		flex-basis: 100%;
		margin: 0;
		font-size: 14px;
	}
</style>
