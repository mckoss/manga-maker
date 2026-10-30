<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Users · Manga Maker</title></svelte:head>

<h1>Users</h1>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.message}<p class="ok">{form.message}</p>{/if}

<table>
	<thead>
		<tr><th>Username</th><th>Created</th><th>Reset password</th><th></th></tr>
	</thead>
	<tbody>
		{#each data.users as user (user.id)}
			<tr>
				<td>
					{user.username}
					{#if user.isAdmin}<span class="badge">admin</span>{/if}
				</td>
				<td>{user.createdAt.toLocaleDateString()}</td>
				<td>
					<form method="POST" action="?/reset" class="inline">
						<input type="hidden" name="id" value={user.id} />
						<input type="hidden" name="username" value={user.username} />
						<input
							name="password"
							type="password"
							autocomplete="new-password"
							placeholder="New password"
							minlength="12"
							required
						/>
						<button type="submit">Reset</button>
					</form>
				</td>
				<td>
					{#if user.id !== data.user?.id}
						<form
							method="POST"
							action="?/delete"
							onsubmit={(e) => {
								if (!confirm(`Delete ${user.username} and all their work?`)) e.preventDefault();
							}}
						>
							<input type="hidden" name="id" value={user.id} />
							<input type="hidden" name="username" value={user.username} />
							<button type="submit" class="danger">Delete</button>
						</form>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<form method="POST" action="?/add" class="card">
	<h2>Add user</h2>
	<label>
		Username
		<input name="username" autocomplete="off" autocapitalize="none" required />
	</label>
	<label>
		Initial password
		<input name="password" type="password" autocomplete="new-password" minlength="12" required />
	</label>
	<button type="submit">Add user</button>
</form>

<p class="hint">
	Admins are the usernames listed in <code>config/admins.txt</code> on the server.
</p>
