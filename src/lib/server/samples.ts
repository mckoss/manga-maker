/**
 * The kinds of test picture every style is drawn with. Covering figures,
 * faces, places and motion shows how a style handles each kind of panel.
 * The AI writes the actual scene for each to suit the style's setting and
 * era. Location scenes say "empty" and "No people": genre words in a style
 * otherwise put people in them.
 */
export const SAMPLE_SUBJECTS = [
	{
		key: 'figure',
		label: 'Figure',
		role: 'one character, full body, standing in a neutral pose, on a plain white background'
	},
	{
		key: 'face',
		label: 'Face',
		role: "a close-up of one character's face showing a clear emotion"
	},
	{
		key: 'interior',
		label: 'Interior',
		role: 'an empty indoor room typical of the setting',
		empty: true
	},
	{
		key: 'exterior',
		label: 'Exterior',
		role: 'an empty outdoor street or landscape typical of the setting',
		empty: true
	},
	{
		key: 'action',
		label: 'Action',
		role: 'one character in a dynamic action pose, with a sense of motion'
	}
] satisfies { key: string; label: string; role: string; empty?: true }[];

export type SubjectKey = (typeof SAMPLE_SUBJECTS)[number]['key'];
