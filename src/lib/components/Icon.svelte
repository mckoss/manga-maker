<script lang="ts">
	/** Control pictograms from lucide-static 0.468.0 (ISC), as in the design system. */
	export type IconName = 'lock' | 'lock-open' | 'dices';

	let {
		name,
		size = 16,
		stroke = 2
	}: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'dices'}
		<rect width="12" height="12" x="2" y="10" rx="2" ry="2" />
		<path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6" />
		<path d="M6 18h.01" />
		<path d="M10 14h.01" />
		<path d="M15 6h.01" />
		<path d="M18 9h.01" />
	{:else}
		<rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
		{#if name === 'lock'}
			<path d="M7 11V7a5 5 0 0 1 10 0v4" />
		{:else}
			<path d="M7 11V7a5 5 0 0 1 9.9-1" />
		{/if}
	{/if}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
