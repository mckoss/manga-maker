<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ItemView } from '#lib/server/versions.js';
	import { outOfDateText } from './labels.js';
	import Icon from './Icon.svelte';

	/**
	 * Where a generated artifact (text or picture) stands, and the one way to
	 * make a new version of it. An artifact is not created, generated, or out
	 * of date (made from inputs that have changed since). Generate is offered
	 * when there is nothing yet; Regenerate only when something changed: an
	 * input it was made from, its seed, or an amendment the user typed. A
	 * locked artifact is never regenerated, so nothing is offered.
	 */
	let {
		item,
		label,
		action,
		fields = {},
		seed = false,
		placeholder = '',
		canGenerate = true,
		waiting = '',
		upstream = false
	}: {
		item: ItemView;
		/** Names the artifact for screen readers: "Regenerate Interior". */
		label: string;
		/** The form action that makes a new version. */
		action: string;
		/** Hidden fields the action needs, such as which artifact. */
		fields?: Record<string, string>;
		/** A picture: offer its seed. */
		seed?: boolean;
		/** An example amendment. */
		placeholder?: string;
		/** False while something it needs is missing; `waiting` says what. */
		canGenerate?: boolean;
		waiting?: string;
		/** Up to date, but an earlier step it is made from is out of date. */
		upstream?: boolean;
	} = $props();

	let current = $derived(item.versions.find((v) => v.id === item.currentId));
	let outOfDate = $derived(current?.outOfDate ?? []);
	let amendment = $state('');
	/** A picture's image model for this round; empty uses the series'. */
	let modelValue = $state('');
	/** The series' model and the choices, from the series layout (absent elsewhere). */
	let models = $derived(
		seed ? (page.data.imageModels as { value: string; label: string }[] | undefined) : undefined
	);
	let seriesModel = $derived(page.data.imageModel as { value: string; label: string } | undefined);
	let seedValue = $state<string | null>(null);
	let seedNow = $derived(seedValue ?? (current?.seed != null ? String(current.seed) : ''));
	let seedChanged = $derived(
		seed && seedValue !== null && seedValue !== String(current?.seed ?? '')
	);
	let offered = $derived(
		!current || outOfDate.length > 0 || amendment.trim() !== '' || seedChanged || modelValue !== ''
	);
	/** A new random seed, as large as the image models accept. */
	const dice = () => (seedValue = String(Math.floor(Math.random() * 2 ** 48)));
</script>

{#if item.pending}
	<p class="state"><span class="spinner"></span> Generating…</p>
{:else if !item.locked}
	<form
		method="POST"
		action="?/{action}"
		class="regen"
		use:enhance={() =>
			async ({ update }) => {
				amendment = '';
				seedValue = null;
				modelValue = '';
				await update();
			}}
	>
		{#each Object.entries(fields) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		{#if !current}
			<p class="state"><span class="badge muted">Not created</span></p>
		{:else if outOfDate.length}
			<p class="state">
				<span class="badge warn">Out of date</span>
				<span class="why">{outOfDateText(outOfDate)}</span>
			</p>
		{:else if upstream}
			<p class="state"><span class="badge muted">Earlier step changed</span></p>
		{/if}
		{#if item.error}<p class="error">The last attempt failed: {item.error}</p>{/if}
		{#if canGenerate}
			<div class="inputs">
				<input
					name="guidance"
					class="amend"
					bind:value={amendment}
					placeholder={placeholder ? `Amend: ${placeholder}` : 'Amend the prompt (optional)'}
					aria-label="Amendment for {label}"
				/>
				{#if seed}
					<span class="seed">
						<input
							name="seed"
							inputmode="numeric"
							pattern="[0-9]*"
							value={seedNow}
							oninput={(e) => (seedValue = e.currentTarget.value.replace(/\D/g, ''))}
							placeholder="random seed"
							aria-label="Seed for {label}"
						/>
						<button
							type="button"
							class="secondary small"
							onclick={dice}
							aria-label="New random seed for {label}"><Icon name="dices" size={15} /></button
						>
					</span>
				{/if}
				{#if models && seriesModel}
					<select
						name="model"
						class="model"
						bind:value={modelValue}
						aria-label="Image model for {label}"
					>
						<option value="">{seriesModel.label} (series)</option>
						{#each models.filter((m) => m.value !== seriesModel.value) as m (m.value)}
							<option value={m.value}>{m.label}</option>
						{/each}
					</select>
				{/if}
			</div>
			{#if offered}
				<button
					type="submit"
					class="small"
					aria-label="{current ? 'Regenerate' : 'Generate'} {label}"
					>{current ? 'Regenerate' : 'Generate'}</button
				>
			{/if}
		{:else if waiting}
			<p class="hint">{waiting}</p>
		{/if}
	</form>
{/if}

<style>
	.regen {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
		min-width: 0;
		margin: 0;
	}
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font-size: 13px;
	}
	.why {
		color: var(--warn);
	}
	.error,
	.hint {
		margin: 0;
		font-size: 13px;
	}
	/* Amendment and seed each take a full row, so they fit a narrow picture column. */
	.inputs {
		display: grid;
		gap: var(--space-2);
		width: 100%;
		min-width: 0;
	}
	.inputs input {
		width: 100%;
		min-width: 0;
		padding: 5px 8px;
		font-size: 14px;
	}
	.seed {
		display: flex;
		gap: var(--space-1);
		min-width: 0;
	}
	.seed input {
		flex: 1;
		font: 400 13px var(--font-mono);
	}
	.seed button {
		flex: none;
		width: 32px;
		padding: 0;
	}
	.model {
		width: 100%;
		min-width: 0;
		font-size: 13px;
	}
</style>
