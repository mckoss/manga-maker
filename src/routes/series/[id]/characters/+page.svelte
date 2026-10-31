<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let id = $derived(String(data.series.id));
	const roleLabel = (role: string) => data.roles.find((r) => r.value === role)?.label ?? role;
</script>

<svelte:head><title>Characters · {data.series.title} · Manga Maker</title></svelte:head>

<h1>Characters</h1>
<p class="hint">
	Build your cast one character at a time. Describe each in a few words; the AI develops a profile
	(personality, motivation, look) that you can edit. Then draw design options in your style and pick
	one as the character's reference picture, so they look the same in every panel. A short chapter
	usually needs two to five characters.
</p>

{#if !data.styleReady}
	<p class="notice">
		You can write profiles now, but pictures are drawn in your series' style:
		<a href={resolve('/series/[id]/style', { id })}>draw a sample picture of the style</a> first.
	</p>
{/if}

{#if data.cast.length}
	<ul class="cast">
		{#each data.cast as c (c.id)}
			<li>
				<a href={resolve('/series/[id]/characters/[cid]', { id, cid: String(c.id) })}>
					{#if c.thumb}
						<img src={resolve('/assets/[hash]', { hash: c.thumb })} alt="" loading="lazy" />
					{:else}
						<div class="no-picture" aria-hidden="true">{(c.name || '?').slice(0, 1)}</div>
					{/if}
					<strong>{c.name || 'Unnamed'}</strong>
					<small>{roleLabel(c.role)} · {c.thumb ? 'reference chosen' : 'designing'}</small>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<h2>Add a character</h2>
<form method="POST" action="?/add" class="card wide">
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	<div class="row">
		<label>
			Name (optional)
			<input
				name="name"
				maxlength="80"
				value={form?.name ?? ''}
				placeholder="Let the AI suggest one"
			/>
		</label>
		<label>
			Role
			<select name="role">
				{#each data.roles as role (role.value)}
					<option
						value={role.value}
						selected={(form?.role ?? (data.cast.length ? 'supporting' : 'protagonist')) ===
							role.value}>{role.label}</option
					>
				{/each}
			</select>
		</label>
	</div>
	<label>
		Describe them
		<textarea
			name="brief"
			rows="3"
			placeholder="A runaway noble girl who fights with a staff and hides a soft heart under a sharp tongue."
			>{form?.brief ?? ''}</textarea
		>
	</label>
	<button type="submit">Add character</button>
</form>

<style>
	.cast {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 1rem;
	}
	.cast a {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		color: inherit;
		text-decoration: none;
	}
	.cast img,
	.no-picture {
		width: 100%;
		aspect-ratio: 3 / 4;
		object-fit: cover;
		object-position: top;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--card);
	}
	.no-picture {
		display: grid;
		place-items: center;
		font-size: 2.5rem;
		color: var(--muted);
	}
	.cast a:hover img,
	.cast a:hover .no-picture {
		border-color: var(--accent);
	}
	small {
		color: var(--muted);
	}
	.notice {
		padding: 0.6rem 0.9rem;
		border-left: 3px solid var(--accent);
		background: var(--card);
	}
</style>
