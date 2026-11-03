/**
 * The series logo: a square branding mark for the whole series, shown in
 * place of the series' initial wherever the series appears. It is drawn
 * from the protagonist's reference picture, in front of the series' default
 * location (or, without one, a typical scene of the story), and is versioned
 * like everything else the AI makes.
 */
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import type { Db } from './db';
import { characters, series, versions, type ColorMode, type Series } from './db/schema';
import { randomSeed } from './ai/image';
import { putImage, readAsset } from './assets';
import { enqueue, type JobHandler } from './jobs';
import { references } from './characters';
import { defaultLocationId, locationReferences, locationScope } from './locations';
import { LOGO_KIND, ownedSeries, seriesScope, touchSeries } from './series';
import { drawingStyle, sentence, toneOnly, TONE_REMINDER } from './styles';
import {
	attachJob,
	currentVersions,
	describeScope,
	dropPending,
	ensureItem,
	finishVersion,
	startVersion,
	VersionError,
	type ItemView
} from './versions';

export class LogoError extends Error {}

/** The square the reference is set into before the edit; the edit keeps its shape. */
const LOGO_SIZE = 1024;
/** Paper, to match the app: the edit model paints over it. */
const CANVAS = { r: 250, g: 244, b: 232, alpha: 1 };

const INPUT_LABELS: Record<string, string> = {
	protagonist: 'the protagonist',
	reference: 'the protagonist’s reference picture',
	setting: 'the logline',
	location: 'the default location',
	color: 'the color mode'
};

/** What the logo is drawn from, or why it can't be drawn yet. */
interface LogoSource {
	series: Series;
	colorMode: ColorMode;
	/** The story's setting, for the background. */
	setting: string;
	protagonist?: { id: number; name: string; referenceId: number; referenceHash: string };
	/** The default location, once it has a reference picture: the background. */
	place?: { id: number; name: string; referenceId: number; referenceHash: string; what: string };
}

function sourceOf(db: Db, row: Series): LogoSource {
	const style = row.styleId ? drawingStyle(db, row.styleId) : undefined;
	const leads = db
		.select()
		.from(characters)
		.where(and(eq(characters.seriesId, row.id), eq(characters.role, 'protagonist')))
		.orderBy(characters.id)
		.all();
	const refs = references(
		db,
		leads.map((c) => c.id)
	);
	// The first protagonist with a reference picture.
	const lead = leads.find((c) => refs.get(c.id)?.assetHash);
	const ref = lead ? refs.get(lead.id) : undefined;
	const placeId = defaultLocationId(db, row);
	const placeRef = placeId ? locationReferences(db, [placeId]).get(placeId) : undefined;
	return {
		series: row,
		colorMode: style?.colorMode ?? 'bw',
		setting: row.logline.trim() || style?.description.trim() || '',
		protagonist:
			lead && ref?.assetHash
				? { id: lead.id, name: lead.name, referenceId: ref.id, referenceHash: ref.assetHash }
				: undefined,
		place:
			placeId && placeRef?.assetHash
				? {
						id: placeId,
						name: currentVersions(db, locationScope(placeId)).get('name')?.text ?? '',
						referenceId: placeRef.id,
						referenceHash: placeRef.assetHash,
						what: currentVersions(db, locationScope(placeId)).get('setting')?.text ?? ''
					}
				: undefined
	};
}

const inputsOf = (src: LogoSource) => ({
	protagonist: String(src.protagonist?.id ?? ''),
	reference: String(src.protagonist?.referenceId ?? ''),
	setting: src.setting,
	color: src.colorMode,
	// Only once there is one, so logos drawn before locations existed stay up to date.
	...(src.place ? { location: String(src.place.referenceId) } : {})
});

/**
 * The edit instruction: the protagonist, kept exactly, as a bold emblem in
 * front of a scene that says what the story is. With a default location,
 * the location is image 1 (the edit model builds on the first image and
 * borrows from the rest) and the protagonist image 2: put the other way
 * round, the model keeps the character's blank backdrop and drops the place.
 */
export function logoPrompt(
	colorMode: ColorMode,
	setting: string,
	guidance = '',
	place = ''
): string {
	const keep =
		'Keep the same character exactly: the same face, hair, body, clothing and props. Keep the same drawing style, line work and shading.';
	if (place.trim())
		return toneOnly(
			colorMode,
			[
				`Close-up of the character from image 2 in front of the place in image 1, ${place.trim()}:`,
				"the character's head and shoulders fill the lower two thirds of the square, facing slightly to one side with a confident expression, and the place rises behind them.",
				'Keep the place in image 1 recognizable. Bold, simple shapes that read at a small size, like the emblem of a manga series. No text or lettering.',
				sentence(guidance),
				keep,
				TONE_REMINDER[colorMode]
			]
				.filter(Boolean)
				.join(' ')
		);
	const background = setting.trim()
		? sentence(`Behind them, a typical scene from the story: ${setting.trim()}`)
		: 'Behind them, a typical scene from their world.';
	return toneOnly(
		colorMode,
		[
			'Make a square emblem for a manga series from this picture.',
			'Show the same character from the chest up, large and centered, facing slightly to one side with a confident expression.',
			background,
			'Bold, simple shapes that read at a small size, framed to fill the square. No text or lettering.',
			sentence(guidance),
			keep,
			TONE_REMINDER[colorMode]
		]
			.filter(Boolean)
			.join(' ')
	);
}

/** The logo item with its versions, and what it would be drawn from now. */
export function getLogo(db: Db, ownerId: number, seriesId: number) {
	const row = ownedSeries(db, ownerId, seriesId);
	const src = sourceOf(db, row);
	ensureItem(db, ownerId, seriesScope(seriesId), LOGO_KIND);
	const views = describeScope(db, seriesScope(seriesId), () => inputsOf(src), INPUT_LABELS);
	const item = views.get(LOGO_KIND) as ItemView;
	return {
		item,
		protagonist: src.protagonist ? { id: src.protagonist.id, name: src.protagonist.name } : null,
		place: src.place ? { id: src.place.id, name: src.place.name } : null,
		canDraw:
			Boolean(src.protagonist) && Boolean(row.styleId && drawingStyle(db, row.styleId)?.ready)
	};
}

export type LogoDetail = ReturnType<typeof getLogo>;

/** Draw a new version of the logo, with optional guidance and seed. */
export function requestLogo(
	db: Db,
	ownerId: number,
	seriesId: number,
	opts: { guidance?: string; seed?: number | null } = {}
): void {
	const row = ownedSeries(db, ownerId, seriesId);
	const style = row.styleId ? drawingStyle(db, row.styleId) : undefined;
	if (!style?.ready) throw new LogoError('Finish the style first: draw a sample picture.');
	if (!sourceOf(db, row).protagonist) {
		throw new LogoError('Choose a reference picture for your protagonist first.');
	}
	const item = ensureItem(db, ownerId, seriesScope(seriesId), LOGO_KIND);
	try {
		const version = startVersion(db, item, {
			seed: opts.seed ?? randomSeed(),
			guidance: opts.guidance
		});
		const job = enqueue(db, ownerId, 'series.logo', { seriesId, versionId: version.id });
		attachJob(db, [version.id], job.id);
	} catch (e) {
		if (e instanceof VersionError) throw new LogoError(e.message);
		throw e;
	}
	touchSeries(db, seriesId);
}

/** Stop drawing the logo. */
export function stopLogo(db: Db, ownerId: number, seriesId: number): void {
	ownedSeries(db, ownerId, seriesId);
	dropPending(db, [ensureItem(db, ownerId, seriesScope(seriesId), LOGO_KIND).id]);
}

const logoHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { seriesId, versionId } = job.payload as { seriesId: number; versionId: number };
	const row = db.select().from(series).where(eq(series.id, seriesId)).get();
	if (!row) return; // deleted meanwhile
	const src = sourceOf(db, row);
	if (!src.protagonist) throw new Error('The protagonist has no reference picture.');
	const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
	if (version?.status !== 'pending') return; // dropped or superseded meanwhile
	// Set the tall reference into a square, so the edit comes out square.
	const square = await sharp(readAsset(src.protagonist.referenceHash))
		.resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: CANVAS })
		.png()
		.toBuffer();
	const images = [square];
	if (src.place) {
		// The default location, cropped to the same square, goes first: the
		// edit builds on image 1 and only borrows the character from image 2.
		images.unshift(
			await sharp(readAsset(src.place.referenceHash))
				.resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover' })
				.png()
				.toBuffer()
		);
	}
	const prompt = logoPrompt(
		src.colorMode,
		src.setting,
		version.guidance,
		src.place ? src.place.what || src.place.name || 'the series’ main location' : ''
	);
	const result = await ai.image.edit({ prompt, images, seed: version.seed ?? 0 }, signal);
	const { hash, thumbHash } = await putImage(db, result.png);
	finishVersion(db, versionId, { text: prompt, assetHash: hash, thumbHash, inputs: inputsOf(src) });
	touchSeries(db, seriesId);
};

export const logoJobHandlers: Record<string, JobHandler> = { 'series.logo': logoHandler };
