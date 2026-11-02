<script lang="ts">
	/** Control pictograms from lucide-static 0.468.0 (ISC), as in the design system. */
	export type IconName = 'lock' | 'lock-open';

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
	<rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
	{#if name === 'lock'}
		<path d="M7 11V7a5 5 0 0 1 10 0v4" />
	{:else}
		<path d="M7 11V7a5 5 0 0 1 9.9-1" />
	{/if}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
