<script lang="ts">
	import { enhance } from '$app/forms';
	import type { StyleDetail } from '#lib/server/styles.js';

	/**
	 * The art director's questions about a thin description. Answers are
	 * folded into a new version of the description; nothing waits on them.
	 */
	let { questions }: { questions: StyleDetail['questions'] } = $props();

	let answers = $state<string[]>([]);
	// A new set of questions starts with empty answers. Only a new set: the
	// page reloads its data every few seconds while the AI works.
	let askedIn: number | null = null;
	$effect(() => {
		if (questions.item.currentId === askedIn) return;
		askedIn = questions.item.currentId;
		answers = questions.list.map(() => '');
	});
</script>

{#if questions.item.pending}
	<p class="hint"><span class="spinner"></span> The art director is reading your description…</p>
{:else if questions.list.length}
	<div class="card wide mentor questions">
		<p>
			<strong>AI art director:</strong> A few questions, so the style fits what you have in mind. Answer
			any you like; the rest are skipped.
		</p>
		<form method="POST" action="?/answerQuestions" use:enhance>
			{#each questions.list as q, i (i)}
				<fieldset>
					<legend>{q.question}</legend>
					{#if q.suggestions.length}
						<div class="suggestions">
							{#each q.suggestions as suggestion (suggestion)}
								<button
									type="button"
									class="secondary small"
									class:chosen={answers[i] === suggestion}
									onclick={() => (answers[i] = suggestion)}>{suggestion}</button
								>
							{/each}
						</div>
					{/if}
					<input
						name="answer"
						aria-label="Answer: {q.question}"
						placeholder="Or in your own words"
						bind:value={answers[i]}
					/>
				</fieldset>
			{/each}
			<div class="row">
				<button type="submit" disabled={!answers.some((a) => a.trim())}
					>Add my answers to the description</button
				>
				<button type="submit" class="secondary" formaction="?/skipQuestions"
					>Skip these questions</button
				>
			</div>
		</form>
	</div>
{:else if questions.item.error}
	<p class="error">The art director could not read the description: {questions.item.error}</p>
{:else}
	<form method="POST" action="?/askQuestions" use:enhance>
		<button type="submit" class="secondary small">Ask the art director what's missing</button>
	</form>
{/if}

<style>
	.questions {
		display: grid;
		gap: 0.6rem;
	}
	.questions p {
		margin: 0;
	}
	fieldset {
		display: grid;
		gap: 0.4rem;
	}
	legend {
		font-weight: 600;
	}
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chosen {
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
