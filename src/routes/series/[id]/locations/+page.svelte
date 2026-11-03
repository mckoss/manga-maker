<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let id = $derived(String(data.series.id));
</script>

<svelte:head><title>Locations · {data.series.title} · Manga Maker</title></svelte:head>

<h1>Locations</h1>
<p class="hint">
	The places your story returns to: a street, a classroom, a ship's deck. Describe each in a few
	words; the AI develops a profile (its role in the story, atmosphere, layout) that you can edit.
	Then draw design options in your style and pick one as the location's reference picture, so
	backgrounds stay the same from panel to panel. One location is the series' default: the first you
	make, until you choose another.
</p>

{#if !data.styleReady}
	<p class="notice">
		You can write profiles now, but pictures are drawn in your series' style:
		<a href={resolve('/series/[id]/style', { id })}>draw a sample picture of the style</a> first.
	</p>
{/if}

{#if form?.error && !('brief' in form)}<p class="error" role="alert">{form.error}</p>{/if}

{#if data.places.length}
	<ul class="places">
		{#each data.places as place (place.id)}
			<li class:default={place.isDefault}>
				<a href={resolve('/series/[id]/locations/[lid]', { id, lid: String(place.id) })}>
					{#if place.thumb}
						<img src={resolve('/assets/[hash]', { hash: place.thumb })} alt="" loading="lazy" />
					{:else}
						<div class="no-picture" aria-hidden="true">{(place.name || '?').slice(0, 1)}</div>
					{/if}
					<strong>{place.name || 'Unnamed'}</strong>
					<small>{place.thumb ? 'reference chosen' : 'designing'}</small>
				</a>
				{#if place.isDefault}
					<span class="badge shu">Default location for series</span>
				{:else}
					<form method="POST" action="?/makeDefault" use:enhance>
						<input type="hidden" name="locationId" value={place.id} />
						<button
							type="submit"
							class="secondary small"
							aria-label="Make {place.name || 'this location'} the default location for series"
							>Make default</button
						>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<h2>Add a location</h2>
<form method="POST" action="?/add" class="card wide">
	{#if form?.error && 'brief' in form}<p class="error" role="alert">{form.error}</p>{/if}
	<label>
		Name (optional)
		<input
			name="name"
			maxlength="80"
			value={form && 'name' in form ? form.name : ''}
			placeholder="Let the AI suggest one"
		/>
	</label>
	<label>
		Describe it
		<textarea
			name="brief"
			rows="3"
			placeholder="The inn where the travelers meet, high in a mountain pass, smoky and loud after dark."
			>{form && 'brief' in form ? form.brief : ''}</textarea
		>
	</label>
	<button type="submit">Add location</button>
</form>

<style>
	.places {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
	}
	.places li {
		display: grid;
		gap: var(--space-2);
		align-content: start;
		justify-items: start;
	}
	.places a {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 100%;
		color: inherit;
		text-decoration: none;
	}
	.places form {
		margin: 0;
	}
	.places img,
	.no-picture {
		width: 100%;
		aspect-ratio: 7 / 4;
		object-fit: cover;
		border: var(--border-panel);
		box-sizing: border-box;
		background: var(--card);
		transition:
			transform var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out);
	}
	.default img,
	.default .no-picture {
		border-color: var(--shu);
	}
	.no-picture {
		display: grid;
		place-items: center;
		font: 2.5rem var(--font-display);
		color: var(--ink);
	}
	.places a:hover img,
	.places a:hover .no-picture {
		transform: translate(-2px, -2px);
		box-shadow: var(--shadow-ink);
	}
	small {
		color: var(--muted);
	}
	.notice {
		padding: 0.6rem 0.9rem;
		border: var(--border-control);
		border-left: 4px solid var(--shu);
		background: var(--surface-panel);
	}
</style>
