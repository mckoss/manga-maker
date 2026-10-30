<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<h1>Make a manga</h1>

<p>
	Manga Maker walks you through a comic in phases. Each phase builds on the one before, and you can
	always go back.
</p>

<ol class="phases">
	<li>
		<a href={resolve('/styles')}><strong>Style</strong></a> — choose and approve how your comic is drawn:
		line work, shading, colour.
	</li>
	<li class="soon"><strong>Characters</strong> — design your cast and approve reference sheets.</li>
	<li class="soon"><strong>Scenes</strong> — design the locations where the story happens.</li>
	<li class="soon">
		<strong>Plot and script</strong> — shape the story, then break it into pages.
	</li>
	<li class="soon"><strong>Manga</strong> — generate panels, letter them, export a PDF.</li>
</ol>
