import type { Db } from '../db';
import type { Version } from '../db/schema';
import type { AiServices } from '../ai';
import type { ItemView, VersionContent } from '../versions';
import type { Scope, ScopeKind, SlotRef } from './ids';

/**
 * The declarative description of a pipeline: what items a domain (a
 * character, a location) has, what each is made from, and how a job makes
 * them. `engine.ts` runs any pipeline described this way: statuses, what is
 * due, starting versions and jobs, finishing them and carrying a cascade on.
 */

/** How a step is made: written by the AI, drawn, computed, or chosen by the user. */
export type StepKind = 'ai-text' | 'ai-image' | 'tool' | 'user';

/** What every pipeline's state carries, besides its domain data. */
export interface PipelineState {
	/** The id of the thing the pipeline belongs to (a character's id). */
	id: number;
	/** Who owns its items. */
	ownerId: number;
	scope: Scope;
	/** The current version of every item, keyed by slot (see `slotKey`). */
	current: Map<string, Version>;
}

/** Recorded inputs: what a version was made from. */
export type Inputs = Record<string, string>;

/** What a job made for one slot; the engine fills in `inputs` unless given. */
export type StepOutput = Omit<VersionContent, 'origin'>;

export interface StepRunContext<S> {
	db: Db;
	ai: AiServices;
	signal: AbortSignal;
	/** The state loaded when the job started. */
	state: S;
	/**
	 * The slots this job makes, with their pending versions. A version is
	 * undefined if it was dropped meanwhile (a per-stage job still makes the
	 * rest, and says it is rewriting it, as it was asked to).
	 */
	slots: { ref: SlotRef; version: Version | undefined }[];
	/** The user's guidance for the whole job (per-stage jobs). */
	guidance: string;
}

/**
 * Make the slots of a job. Returns content by slot key; null (or a slot
 * left out) drops that slot's pending version. Returning null for the whole
 * job says it had nothing to do (its versions were dropped, or the state no
 * longer allows it): its versions are left as they are, and neither
 * `afterFinish` nor the cascade runs.
 */
export type StepRun<S> = (ctx: StepRunContext<S>) => Promise<Map<string, StepOutput | null> | null>;

/** Options for the versions a start makes. */
export interface StartOpts {
	/** The user's amendment to the prompt, kept with the version it makes. */
	guidance?: string;
	/** A picture's seed; by default the domain picks one (see `Stage.prepare`). */
	seed?: number | null;
	/** An image model chosen for this start. */
	model?: string;
	/** Stages to carry on with once this one finishes. */
	cascade?: string[];
	/** Started by `advance` (update everything), not by a request. */
	advancing?: boolean;
}

/** What `startVersion` gets for one slot. */
export interface VersionOpts {
	seed?: number | null;
	guidance?: string;
	model?: string;
}

/** Where every item stands, computed once from one scan of the scope. */
export interface Snapshot {
	views: Map<string, ItemView>;
	status(slot: string): Status;
	/** Every earlier step is settled: anchored, or up to date. */
	settled(slot: string): boolean;
	/** Can be regenerated now: not kept, missing or out of date, earlier steps settled. */
	due(slot: string): boolean;
	/** The current version's out-of-date reasons, or [] when it is up to date or missing. */
	outOfDate(slot: string): string[];
}

/**
 * Where an item stands:
 * - missing: never made;
 * - pending: being made;
 * - outdated: made from inputs that have changed since;
 * - upstream: up to date with its inputs, but an earlier step it is made
 *   from is out of date (and not anchored), so it will change once that does;
 * - ok.
 */
export type Status = 'missing' | 'pending' | 'outdated' | 'upstream' | 'ok';

export interface Stage<S extends PipelineState> {
	/** The stage's name within its domain ('designs'); its step id is `${domain}.${id}`. */
	id: string;
	kind: StepKind;
	/** The item kinds this stage makes, so any item finds its stage. */
	kinds: readonly string[];
	/** The slots the stage makes now (its fan-out). */
	slots(s: S): SlotRef[];
	/** What a new version of a slot would be made from. */
	inputs(s: S, slot: SlotRef): Inputs;
	/** The slots a slot is made from. */
	upstream(s: S, slot: SlotRef): SlotRef[];
	/** Gates beyond upstream being settled: false means nothing in the stage is due. */
	ready?(s: S): boolean;
	/** Counts as settled for what is made from it, whatever its status (kept items always do). */
	anchored?(view: ItemView | undefined, slot: SlotRef): boolean;
	/** The versions to start, one per slot (seeds, models, guidance). */
	prepare?(ctx: {
		db: Db;
		state: S;
		slots: SlotRef[];
		opts: StartOpts;
		snapshot: () => Snapshot;
	}): VersionOpts[];
	/**
	 * The job that makes the stage: one for all its slots, or one per slot.
	 * A per-stage payload names its slots by key ("1"), or by the whole slot
	 * ("beat:hook") with `payloadKeys: 'slot'`; either form is read back.
	 */
	job?: { kind: string; per: 'stage' | 'slot'; run: StepRun<S>; payloadKeys?: 'key' | 'slot' };
	/** Carry the cascade on once a job finishes (default true). */
	cascades?: boolean;
	/**
	 * 'transitive' (default): an item made from a changing earlier step is
	 * "upstream". 'own': only its own inputs count.
	 */
	staleness?: 'transitive' | 'own';
	/** After a job's versions are finished (or abandoned), with the job's slots. */
	afterFinish?(db: Db, s: S, slots: SlotRef[]): void;
}

export interface Pipeline<S extends PipelineState> {
	domain: ScopeKind;
	/** The state for an id, or undefined if it was deleted. */
	load(db: Db, id: number): S | undefined;
	/** In pipeline order; `advance` and cascades follow it. */
	stages: Stage<S>[];
	/** Names of inputs, to say why something is out of date. */
	labels: Record<string, string>;
	/**
	 * What items no stage makes are made from (a clarify flow's questions,
	 * made outside the engine), so they too go out of date; null (the
	 * default) for the user's own.
	 */
	inputsOutside?(s: S, slot: SlotRef): Inputs | null;
	/** The domain's error for a message (a VersionError from starting, say). */
	error?(message: string): Error;
}
