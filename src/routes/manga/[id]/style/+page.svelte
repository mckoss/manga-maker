<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import StyleEditor from './StyleEditor.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
</script>

<svelte:head><title>Style · {data.manga.title} · Manga Maker</title></svelte:head>

{#if data.editor}
	<StyleEditor ed={data.editor} {form} />
{:else}
	<h1>Style</h1>
	<p class="hint">
		The style is how your manga is drawn: line work, shading, colour. Describe the look in your own
		words—favourite manga, mood, how heavy the inking is, the setting and era. The AI turns it into
		a style prompt and test scenes; you refine it by looking at sample pictures, then approve it.
	</p>

	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

	<form method="POST" action="?/start" class="card wide" use:enhance>
		<label>
			Describe the look
			<textarea
				name="description"
				rows="4"
				required
				placeholder="Gritty 90s seinen like a detective story: heavy blacks, rough cross-hatching, realistic proportions, rain and neon."
			></textarea>
		</label>
		<div class="row">
			<label>
				Colour
				<select name="colorMode">
					{#each data.colorModes as mode (mode.value)}
						<option value={mode.value} selected={mode.value === 'bw'}>{mode.label}</option>
					{/each}
				</select>
			</label>
			<label>
				Image model
				<select name="model">
					{#each data.models as model (model.value)}
						<option value={model.value} selected={model.value === 'qwen-image'}
							>{model.label}</option
						>
					{/each}
				</select>
			</label>
		</div>
		<span class="hint"
			>Qwen-Image follows style descriptions closely; Z-Image gives a cleaner, flatter printed-page
			look.</span
		>
		<button type="submit">Start the style</button>
	</form>

	{#if data.reusable.length}
		<h2>Or reuse a style</h2>
		<p class="hint">Start from a copy of the approved style of another of your manga.</p>
		<ul class="reuse">
			{#each data.reusable as style (style.id)}
				<li class="card wide">
					<div class="thumbs">
						{#each style.thumbs as hash, i (i)}
							<img src={asset(hash)} alt="" loading="lazy" />
						{/each}
					</div>
					<form method="POST" action="?/reuse" use:enhance class="row">
						<input type="hidden" name="styleId" value={style.id} />
						<strong>{style.title}</strong>
						<button type="submit" class="secondary">Use this style</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.reuse {
		list-style: none;
		padding: 0;
	}
	.thumbs {
		display: flex;
		gap: 0.4rem;
	}
	.thumbs img {
		width: 20%;
		max-width: 7rem;
		aspect-ratio: 1;
		object-fit: cover;
		border-radius: 4px;
	}
	.reuse form {
		justify-content: space-between;
	}
</style>
