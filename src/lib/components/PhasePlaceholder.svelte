<script lang="ts">
	import { phase, type PhaseKey } from '#lib/phases.js';

	let { key }: { key: PhaseKey } = $props();
	let info = $derived(phase(key));
</script>

<h1>{info.label}</h1>
<p>{info.detail}</p>
<p class="soon">Not built yet.</p>

<style>
	.soon {
		display: inline-block;
		padding: 0.4rem 0.8rem;
		border: 1px dashed var(--line);
		border-radius: 6px;
		color: var(--muted);
	}
</style>
