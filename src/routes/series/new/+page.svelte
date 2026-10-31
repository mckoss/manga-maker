<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>New series · Manga Maker</title></svelte:head>

<h1>New series</h1>

<p class="hint">
	A series has one style and one cast, shared by its chapters; a one-off story is simply a series
	with one chapter. A title is all you need to start, and you can change everything later. Next
	you'll choose how it is drawn.
</p>

<form method="POST" class="card wide">
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	<label>
		Title
		<input
			name="title"
			required
			maxlength="120"
			value={form?.title ?? ''}
			placeholder="Ronin Road"
		/>
	</label>
	<label>
		Logline (optional)
		<textarea
			name="logline"
			rows="2"
			maxlength="500"
			placeholder="A disgraced swordsman escorts a merchant's daughter across a country at war."
			>{form?.logline ?? ''}</textarea
		>
	</label>
	<fieldset>
		<legend>Reading direction</legend>
		{#each data.directions as d (d.value)}
			<label class="check">
				<input
					type="radio"
					name="readingDirection"
					value={d.value}
					checked={(form?.readingDirection ?? 'rtl') === d.value}
				/>
				{d.label} <span class="hint">— {d.hint}</span>
			</label>
		{/each}
	</fieldset>
	<button type="submit">Create series</button>
</form>
