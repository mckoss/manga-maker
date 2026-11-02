<script lang="ts">
	import { enhance } from '$app/forms';

	interface Summary {
		total: number;
		pending: number;
		missing: number;
		stale: number;
		kept: number;
	}

	/**
	 * The character's pipeline, from the user's notes to the character sheet:
	 * each step says whether it is up to date, and how many of its items need
	 * regenerating because something they are made from changed.
	 */
	let {
		flow,
		due
	}: {
		flow: Record<'notes' | 'profile' | 'designs' | 'pictures' | 'reference' | 'sheet', Summary>;
		/** Items that can be regenerated right now, over all steps. */
		due: number;
	} = $props();

	const STEPS = [
		{ key: 'notes', label: 'Your notes', href: '#notes', made: 'by you' },
		{ key: 'profile', label: 'Profile', href: '#profile', made: 'by the AI' },
		{ key: 'designs', label: 'Design variants', href: '#designs', made: 'by the AI' },
		{ key: 'pictures', label: 'Option pictures', href: '#designs', made: 'drawn' },
		{ key: 'reference', label: 'Reference', href: '#reference', made: 'chosen by you' },
		{ key: 'sheet', label: 'Character sheet', href: '#sheet', made: 'drawn' }
	] as const;

	function state(key: (typeof STEPS)[number]['key'], s: Summary) {
		if (s.pending) return { tone: 'busy', text: 'working…' };
		if (key === 'notes') return s.missing === s.total ? { tone: 'todo', text: 'empty' } : null;
		if (key === 'reference') {
			if (s.missing) return { tone: 'todo', text: 'not chosen' };
			return s.stale ? { tone: 'stale', text: 'out of date' } : null;
		}
		if (s.missing === s.total) return { tone: 'todo', text: 'not made yet' };
		if (s.stale) return { tone: 'stale', text: `${s.stale} to update` };
		if (s.missing) return { tone: 'todo', text: `${s.missing} not made` };
		return null;
	}
</script>

<nav class="flow" aria-label="How the character is made">
	<ol>
		{#each STEPS as step (step.key)}
			{@const s = flow[step.key]}
			{@const st = state(step.key, s)}
			<li class={st?.tone ?? 'ok'}>
				<!-- In-page links to the step's section. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={step.href}>
					<strong>{step.label}</strong>
					<small>{step.made}</small>
					<span class="state">
						{#if st}{st.text}{:else}✓ up to date{/if}
						{#if s.kept}· {s.kept} locked{/if}
					</span>
				</a>
			</li>
		{/each}
	</ol>
	<form method="POST" action="?/update" use:enhance>
		<button type="submit" disabled={due === 0}>Regenerate everything out of date</button>
		<span class="hint">
			Generates what is missing and regenerates what is out of date and unlocked, step by step, down
			to the sheet. A new reference is always your choice.
		</span>
	</form>
</nav>

<style>
	.flow {
		margin: var(--space-3) 0 var(--space-5);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) 0;
		align-items: stretch;
		counter-reset: step;
	}
	li {
		display: flex;
		align-items: center;
		counter-increment: step;
	}
	/* An ink arrow between steps */
	li:not(:last-child)::after {
		content: '';
		width: 18px;
		height: 10px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 10' fill='%23141210'%3E%3Cpath d='M0 4h12v2H0z'/%3E%3Cpath d='M11 0l7 5-7 5z'/%3E%3C/svg%3E")
			center / contain no-repeat;
	}
	a {
		display: grid;
		gap: 2px;
		min-width: 7.5rem;
		padding: 8px 12px;
		border: var(--border-control);
		background: var(--surface-panel);
		color: var(--ink);
		font: 700 14px/1.2 var(--font-body);
		text-decoration: none;
	}
	a::before {
		content: counter(step, decimal-leading-zero);
		font: 700 10px var(--font-mono);
		color: var(--tone-60);
	}
	a:hover {
		color: var(--ink);
		box-shadow: var(--shadow-ink-sm);
	}
	small {
		font: 400 11px var(--font-body);
		color: var(--muted);
	}
	.state {
		font: 600 12px var(--font-body);
	}
	.ok .state {
		color: var(--ok);
	}
	.stale a {
		border: var(--border-stale);
	}
	.stale .state {
		color: var(--warn);
	}
	.todo .state,
	.busy .state {
		color: var(--muted);
	}
	form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	form .hint {
		margin: 0;
	}
</style>
