/**
 * The steps of making a manga, in order. The first few belong to the series
 * (pages under /series/[id]) and are shared by its chapters; the rest belong
 * to each chapter (under /series/[id]/chapters/[ch]). The sidebar lists them
 * and placeholder pages describe the ones not built yet.
 */
export const PHASES = [
	{
		key: 'style',
		label: 'Style',
		level: 'series',
		summary: 'How the comic is drawn: line work, shading, color.',
		detail:
			'Describe a look, refine it by looking at sample pictures, and lock in what you like. Everything else is drawn in this style.'
	},
	{
		key: 'characters',
		label: 'Characters',
		level: 'series',
		summary: 'Everyone in the series, with reference pictures to keep them consistent.',
		detail:
			'Describe each character with the AI’s help, then pick a reference picture. Every panel draws them from it, so they look the same on every page.'
	},
	{
		key: 'locations',
		label: 'Locations',
		level: 'series',
		summary: 'The places where the story happens.',
		detail:
			'Design the recurring settings—a street, a classroom, a ship’s deck—with reference pictures, so backgrounds stay consistent.'
	},
	{
		key: 'cast',
		label: 'Cast',
		level: 'chapter',
		summary: 'Who appears in this chapter, chosen from the series’ characters.',
		detail:
			'Pick the characters this chapter needs. Each keeps the design it had when it joined, so a redesign later in the series does not change finished pages.'
	},
	{
		key: 'plot',
		label: 'Plot',
		level: 'chapter',
		summary: 'The story’s shape: beginning, turning points, ending.',
		detail:
			'Work out what happens with the AI as a story editor: the hook, the conflict, the turning points and the ending, sized for a short comic.'
	},
	{
		key: 'script',
		label: 'Script',
		level: 'chapter',
		summary: 'The plot broken into pages, panels and dialogue.',
		detail:
			'Turn the plot into a page-by-page script: what each panel shows, who is in it, and what they say.'
	},
	{
		key: 'panels',
		label: 'Panels',
		level: 'chapter',
		summary: 'The pictures, drawn from the script.',
		detail:
			'Generate each panel from the script using your style, characters and locations. Redraw any panel until it is right.'
	},
	{
		key: 'pages',
		label: 'Pages',
		level: 'chapter',
		summary: 'Panels laid out and lettered, ready to export.',
		detail:
			'Arrange panels into page layouts in your reading direction, add speech balloons and captions, and export a PDF.'
	}
] as const;

export type PhaseKey = (typeof PHASES)[number]['key'];

export const SERIES_PHASES = PHASES.filter((p) => p.level === 'series');
export const CHAPTER_PHASES = PHASES.filter((p) => p.level === 'chapter');

export function phase(key: PhaseKey) {
	return PHASES.find((p) => p.key === key)!;
}
