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
						{#if s.kept}· {s.kept} kept{/if}
					</span>
				</a>
			</li>
		{/each}
	</ol>
	<form method="POST" action="?/update" use:enhance>
		<button type="submit" disabled={due === 0}>Update everything not kept</button>
		<span class="hint">
			Regenerates what is out of date, step by step, down to the sheet. A new reference is always
			your choice.
		</span>
	</form>
</nav>

<style>
	.flow {
		margin: 0.75rem 0 1.25rem;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: stretch;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	li:not(:last-child)::after {
		content: '→';
		color: var(--muted);
	}
	a {
		display: grid;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		text-decoration: none;
		color: inherit;
		min-width: 7.5rem;
	}
	small {
		color: var(--muted);
		font-size: 0.75rem;
	}
	.state {
		font-size: 0.8rem;
	}
	.ok .state {
		color: var(--ok);
	}
	.stale a {
		border-color: var(--warn);
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
		gap: 0.75rem;
		margin-top: 0.6rem;
	}
	form .hint {
		margin: 0;
	}
</style>
