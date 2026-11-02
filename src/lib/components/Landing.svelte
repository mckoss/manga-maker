<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * What Manga Maker is, with sample art: shown to visitors on the sign-in
	 * page and to new users before their first series. The call to action
	 * (a sign-in form, or a "start" link) goes in the hero.
	 */
	let { children }: { children: Snippet } = $props();

	/** One cell of a contact sheet in static/examples, as background styles. */
	const cell = (file: string, cols: number, rows: number, col: number, row = 0) =>
		[
			`background-image: url(/examples/${file})`,
			`background-size: ${cols * 100}% ${rows * 100}%`,
			`background-position: ${(col / (cols - 1)) * 100}% ${rows > 1 ? (row / (rows - 1)) * 100 : 50}%`
		].join('; ');

	const STEPS = [
		{
			title: 'Style',
			text: 'Describe a look in your own words. The AI art director asks a few questions, writes the style prompt and draws test scenes until it’s right.',
			art: cell('style-eval-bw.jpg', 5, 1, 1),
			alt: 'A test face drawn in a heavy-ink style'
		},
		{
			title: 'Characters',
			text: 'Each character gets a profile, four design options to choose from, and a sheet of angles and expressions that keeps them consistent.',
			art: cell('character-candidates.jpg', 8, 1, 1),
			alt: 'A design option for a young woman in a work apron'
		},
		{
			title: 'Character sheets',
			text: 'Front, side and back views plus expressions, drawn from the design you chose.',
			art: cell('character-sheets.jpg', 9, 2, 6, 1),
			alt: 'An old ronin laughing, from his expression sheet'
		},
		{
			title: 'Chapters',
			text: 'For each chapter: pick the cast, shape the plot, then script, panels and pages. Being built now.',
			art: '',
			alt: ''
		}
	];
</script>

<section class="hero">
	<div class="pitch">
		<span class="kicker">Make your own manga</span>
		<h1>Make your own manga, one step at a time.</h1>
		<p>
			Describe the look and the people in your story. An AI art director and story editor work
			through it with you: the style, the characters, then each chapter. Every version is kept, and
			you choose what stays.
		</p>
		<div class="cta">{@render children()}</div>
	</div>
	<div class="collage" aria-hidden="true">
		<div class="panel big" style={cell('style-period-scenes.jpg', 5, 2, 4, 1)}></div>
		<div class="panel" style={cell('character-sheets.jpg', 9, 2, 5, 0)}></div>
		<div class="panel" style={cell('style-period-scenes.jpg', 5, 2, 3, 0)}></div>
	</div>
</section>

<section class="how">
	<div class="rule">
		<h2>How it works</h2>
		<span class="kicker">Read left to right</span>
	</div>
	<div class="steps">
		{#each STEPS as step, i (step.title)}
			<article class:ink={!step.art}>
				{#if step.art}<div class="art" role="img" aria-label={step.alt} style={step.art}></div>{/if}
				<div class="text">
					<span class="n">{String(i + 1).padStart(2, '0')}</span>
					<h3>{step.title}</h3>
					<p>{step.text}</p>
				</div>
			</article>
		{/each}
	</div>
</section>

<section class="facts">
	<div>
		<span class="kicker accent">Nothing is lost</span>
		<h2>Lock what you love. Step back through the rest.</h2>
		<p>
			Every picture and every line of text keeps its history. Close the padlock on what you’re happy
			with and the AI won’t touch it. Change your mind later and go back to any earlier version.
		</p>
	</div>
	<div>
		<span class="kicker">Private</span>
		<h2>Runs on your own machine.</h2>
		<p>
			Local language models (Ollama) write and guide; local image models (ComfyUI) draw. Your series
			never leaves your computer.
		</p>
	</div>
</section>

<style>
	.kicker {
		font: var(--type-label);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--tone-60);
	}
	.kicker.accent,
	.pitch .kicker {
		color: var(--shu);
	}
	.hero {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		margin: 0 0 var(--space-8);
		background: var(--surface-panel);
		border: var(--border-heavy);
		box-shadow: var(--shadow-ink-lg);
	}
	.pitch {
		display: grid;
		gap: var(--space-4);
		align-content: center;
		padding: var(--space-7) var(--space-6);
		border-right: var(--border-heavy);
	}
	h1 {
		margin: 0;
		font: 400 clamp(34px, 4.4vw, 56px) / 1.05 var(--font-display);
		text-wrap: balance;
	}
	.pitch p {
		margin: 0;
		max-width: 30rem;
		font: 400 17px/1.6 var(--font-body);
	}
	.cta {
		margin-top: var(--space-2);
	}
	.collage {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1.3fr 1fr;
		gap: var(--gutter);
		padding: var(--gutter);
		min-height: 26rem;
	}
	.panel {
		border: var(--border-panel);
		background-repeat: no-repeat;
	}
	.panel.big {
		grid-column: span 2;
	}
	.rule {
		display: flex;
		align-items: flex-end;
		gap: var(--space-5);
		padding-bottom: var(--space-3);
		margin-bottom: var(--gutter-wide);
		border-bottom: var(--border-panel);
	}
	.rule h2 {
		margin: 0;
	}
	.rule .kicker {
		margin-left: auto;
	}
	.steps {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: var(--gutter);
	}
	article {
		display: grid;
		grid-template-rows: 170px auto;
		background: var(--surface-panel);
		border: var(--border-panel);
	}
	article.ink {
		grid-template-rows: auto;
		background: var(--ink);
		color: var(--paper);
	}
	.art {
		border-bottom: var(--border-panel);
		background-repeat: no-repeat;
	}
	.text {
		display: grid;
		gap: var(--space-2);
		align-content: start;
		padding: 18px;
	}
	.n {
		font: 700 12px var(--font-mono);
		color: var(--tone-60);
	}
	.ink .n {
		color: var(--tone-20);
	}
	h3 {
		margin: 0;
		font: 400 22px/1.15 var(--font-display);
	}
	.ink h3 {
		color: var(--paper);
	}
	.text p {
		margin: 0;
		font: var(--type-hint);
	}
	.ink p {
		color: var(--tone-10);
	}
	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-7);
		margin: var(--space-8) 0 var(--space-6);
		padding-top: var(--space-6);
		border-top: var(--border-panel);
	}
	.facts > div {
		display: grid;
		gap: var(--space-3);
		align-content: start;
	}
	.facts h2 {
		margin: 0;
		text-wrap: balance;
	}
	.facts p {
		margin: 0;
	}
	@media (max-width: 860px) {
		.hero,
		.facts {
			grid-template-columns: minmax(0, 1fr);
		}
		.pitch {
			border-right: none;
			border-bottom: var(--border-heavy);
			padding: var(--space-6) var(--space-5);
		}
		.collage {
			min-height: 18rem;
		}
	}
</style>
