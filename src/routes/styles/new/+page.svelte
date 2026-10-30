<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>New style · Manga Maker</title></svelte:head>

<h1>New style</h1>

<p class="hint">
	Describe the look in your own words: favourite manga, mood, how heavy the inking is, how detailed
	the backgrounds are. The AI turns it into a style prompt, then you refine it by looking at sample
	images.
</p>

<form method="POST" class="card wide">
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	<label>
		Name
		<input name="name" required maxlength="80" value={form?.name ?? ''} placeholder="Rainy noir" />
	</label>
	<label>
		Describe the look
		<textarea
			name="description"
			rows="4"
			required
			placeholder="Gritty 90s seinen like a detective story: heavy blacks, rough cross-hatching, realistic proportions, rain and neon."
			>{form?.description ?? ''}</textarea
		>
	</label>
	<label>
		Colour
		<select name="colorMode">
			{#each data.colorModes as mode (mode.value)}
				<option value={mode.value} selected={(form?.colorMode ?? 'bw') === mode.value}
					>{mode.label}</option
				>
			{/each}
		</select>
	</label>
	<label>
		Image model
		<select name="model">
			{#each data.models as model (model.value)}
				<option value={model.value} selected={(form?.model ?? 'qwen-image') === model.value}
					>{model.label}</option
				>
			{/each}
		</select>
		<span class="hint"
			>Qwen-Image follows style descriptions closely; Z-Image gives a cleaner, flatter printed-page
			look.</span
		>
	</label>
	<button type="submit">Create style</button>
</form>
