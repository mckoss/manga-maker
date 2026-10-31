<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let id = $derived(String(data.series.id));
	let inCast = $derived(data.cast.filter((c) => c.inCast));
	let others = $derived(data.cast.filter((c) => !c.inCast));
	const roleLabel = (role: string) => data.roles.find((r) => r.value === role)?.label ?? role;
	const asset = (hash: string) => resolve('/assets/[hash]', { hash });
</script>

<svelte:head
	><title>Cast · {data.chapter.name} · {data.series.title} · Manga Maker</title></svelte:head
>

<h1>Cast</h1>
<p class="hint">
	Who appears in {data.chapter.name}, chosen from the series'
	<a href={resolve('/series/[id]/characters', { id })}>characters</a>. Each keeps the design it had
	when it joined this chapter; when the series has a newer design, you choose whether this chapter
	moves to it.
</p>
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

<h2>In this chapter</h2>
{#if inCast.length}
	<ul class="cast">
		{#each inCast as c (c.id)}
			<li class="card">
				<a href={resolve('/series/[id]/characters/[cid]', { id, cid: String(c.id) })}>
					{#if c.pinnedThumb}
						<img src={asset(c.pinnedThumb)} alt="{c.name} design" loading="lazy" />
					{:else}
						<div class="no-picture" aria-hidden="true">{(c.name || '?').slice(0, 1)}</div>
					{/if}
					<strong>{c.name || 'Unnamed'}</strong>
				</a>
				<small>{roleLabel(c.role)}{c.pinnedThumb ? '' : ' · no design yet'}</small>
				{#if c.newerThumb}
					<div class="newer">
						<img src={asset(c.newerThumb)} alt="{c.name} newer design" loading="lazy" />
						<span class="badge warn">Newer design</span>
					</div>
					<form method="POST" action="?/useNewest" use:enhance>
						<input type="hidden" name="character" value={c.id} />
						<button type="submit" class="small">Use the newer design</button>
					</form>
				{/if}
				<form method="POST" action="?/remove" use:enhance>
					<input type="hidden" name="character" value={c.id} />
					<button
						type="submit"
						class="secondary small"
						aria-label="Remove {c.name} from the chapter">Remove</button
					>
				</form>
			</li>
		{/each}
	</ul>
{:else}
	<p class="hint">Nobody yet. Add characters from the series, or make a new one.</p>
{/if}

{#if others.length}
	<h2>Also in the series</h2>
	<ul class="cast">
		{#each others as c (c.id)}
			<li class="card">
				{#if c.currentThumb}
					<img src={asset(c.currentThumb)} alt="{c.name} design" loading="lazy" />
				{:else}
					<div class="no-picture" aria-hidden="true">{(c.name || '?').slice(0, 1)}</div>
				{/if}
				<strong>{c.name || 'Unnamed'}</strong>
				<small>{roleLabel(c.role)}</small>
				<form method="POST" action="?/add" use:enhance>
					<input type="hidden" name="character" value={c.id} />
					<button type="submit" class="small" aria-label="Add {c.name} to the chapter">Add</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<h2>New character</h2>
<p class="hint">Joins the series and this chapter.</p>
<form method="POST" action="?/create" class="card wide">
	<div class="row">
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
			Role
			<select name="role">
				{#each data.roles as role (role.value)}
					<option
						value={role.value}
						selected={role.value === (inCast.length ? 'supporting' : 'protagonist')}
						>{role.label}</option
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
			placeholder="A retired thief who runs the ferry and owes everyone a favor."
			>{form && 'brief' in form ? form.brief : ''}</textarea
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
	.cast li {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
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
	.newer {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.newer img {
		width: 3rem;
	}
	small {
		color: var(--muted);
	}
</style>
