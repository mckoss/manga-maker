/**
 * The steps of making a manga, in order. Each has a page under /manga/[id];
 * the sidebar lists them and placeholder pages describe the ones not built yet.
 */
export const PHASES = [
	{
		key: 'style',
		label: 'Style',
		summary: 'How the comic is drawn: line work, shading, color.',
		detail:
			'Describe a look, refine it by looking at sample pictures, and lock in what you like. Everything else is drawn in this style.'
	},
	{
		key: 'characters',
		label: 'Characters',
		summary: 'Your cast, with reference pictures to keep them consistent.',
		detail:
			'Describe each character with the AI’s help, then pick a reference picture. Every panel draws them from it, so they look the same on every page.'
	},
	{
		key: 'locations',
		label: 'Locations',
		summary: 'The places where the story happens.',
		detail:
			'Design the recurring settings—a street, a classroom, a ship’s deck—with reference pictures, so backgrounds stay consistent.'
	},
	{
		key: 'plot',
		label: 'Plot',
		summary: 'The story’s shape: beginning, turning points, ending.',
		detail:
			'Work out what happens with the AI as a story editor: the hook, the conflict, the turning points and the ending, sized for a short comic.'
	},
	{
		key: 'script',
		label: 'Script',
		summary: 'The plot broken into pages, panels and dialogue.',
		detail:
			'Turn the plot into a page-by-page script: what each panel shows, who is in it, and what they say.'
	},
	{
		key: 'panels',
		label: 'Panels',
		summary: 'The pictures, drawn from the script.',
		detail:
			'Generate each panel from the script using your style, characters and locations. Redraw any panel until it is right.'
	},
	{
		key: 'pages',
		label: 'Pages',
		summary: 'Panels laid out and lettered, ready to export.',
		detail:
			'Arrange panels into page layouts in your reading direction, add speech balloons and captions, and export a PDF.'
	}
] as const;

export type PhaseKey = (typeof PHASES)[number]['key'];

export function phase(key: PhaseKey) {
	return PHASES.find((p) => p.key === key)!;
}
