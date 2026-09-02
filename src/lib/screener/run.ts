// The pinned screener run (T-1009-2): what `run_screener` produces and the
// contract EPIC-1010's `get_screener_results`, `set_panel_selection`, and
// `explain_result` read verbatim. This module is a cross-epic boundary --
// change it deliberately, not incidentally, and keep every exported symbol
// documented well enough that a consumer never needs to read T-1009-7's
// engine to understand what a run means.
//
// Domain layer: no I/O, no import from infra or from src/lib/webmcp/.

import type { ResourceId } from '../workbench/domain/ids';
import { toWireProvenance, type MarketDataProvenance } from '../workbench/domain/provenance';
import type { Revision } from '../workbench/domain/workspace';
import type { FilterNode, RankingSpec } from './definition';
import type { ValidationProblem } from './validation';

// The record EPIC-1010's `explain_result` reads so explaining a match is a
// lookup, never a re-evaluation of the filter tree against live data (which
// could disagree with what actually matched, since data moves and a pinned
// run must not). Populated for every enabled node, groups included, not
// just leaf conditions -- a group's own pass/fail is what makes a NOT or an
// OR's outcome explainable, not just its children's.
export interface FilterNodeEvaluation {
	nodeId: ResourceId;
	passed: boolean;
	// null when the node's evaluated value has no single scalar form worth
	// storing (e.g. a pattern hit/miss with no confidence to report).
	value: number | string | boolean | null;
	unit?: string;
	detail?: string;
	// True when at least one field/series/pattern/study this leaf condition
	// reads was unavailable for this instrument -- distinct from a genuine,
	// available fail that also has no scalar `value` to report (e.g. "pattern
	// not detected"). Optional (defaults to "not unavailable" when absent,
	// matching `unit`/`detail`'s convention) so a hand-built record that
	// predates this field still type-checks. Never set true on a group node
	// (engine/tree.ts's walk() only computes this per leaf); explain_result
	// (EPIC-1010) is what turns this into a genuine indeterminate outcome
	// instead of collapsing it into a fail.
	dataUnavailable?: boolean;
}

// One universe instrument the run evaluated but did not return among
// `ScreenerMatch[]` -- either it failed the filter tree outright, or it
// passed but was truncated by the ranking limit before being returned.
// Both cases need `nodeEvaluations` to be explainable (EPIC-1010's
// `explain_result`, AC4: a rejected candidate's failing conditions must be
// identifiable from the pinned run, never by re-evaluating live data).
export interface RejectedCandidate {
	instrumentId: string;
	nodeEvaluations: Record<ResourceId, FilterNodeEvaluation>;
	// Present only when this instrument passed the filter tree and entered
	// ranking (i.e. it was truncated by the result limit, not by the filter
	// tree) -- absent for a genuinely-failed instrument, which was never
	// ranked. `engine/ranking.ts` normalizes every ranking field against the
	// *whole* matched set, not just the returned slice, so a returned
	// instrument's own ranking explanation cannot be honestly recomputed
	// without this: `ScreenerMatch.rankingValues` alone only covers the
	// returned top-N, which can be a strict subset of what was actually
	// normalized against.
	rankingValues?: Record<string, number | null>;
}

// A non-blocking finding surfaced alongside a completed run rather than a
// refusal -- an empty result, degraded data coverage for part of the
// universe, or a cost estimate that was exceeded but not enforced.
// `nodeIds` is present only when the warning concerns specific filter
// nodes; a universe- or run-level warning omits it.
export interface ScreenerWarning {
	code: string;
	message: string;
	nodeIds?: ResourceId[];
}

// One matched instrument in ranked order. `rankingValues` is keyed by
// `field_id` (RankingField.fieldId) so every ranking field's contribution
// is inspectable, not just the composite score that combined them.
// `nodeEvaluations` keyed by `node_id` is the whole reason a match is a
// stored record and not a bare instrument ID: it is what makes
// `explain_result` a lookup.
export interface ScreenerMatch {
	instrumentId: string;
	// 1-based: rank 1 is the best match, matching how a person reads a
	// leaderboard rather than an array index.
	rank: number;
	// null when the screener had no ranking and the default order was used
	// -- there is no score to report, not a zero score.
	compositeScore: number | null;
	rankingValues: Record<string, number | null>;
	nodeEvaluations: Record<ResourceId, FilterNodeEvaluation>;
}

// A pinned, complete execution of one screener revision, addressed by
// `runId`. `status` only ever holds `'complete'` on a value of this type --
// see ScreenerRunRefusal below for why a refused attempt is a different
// type rather than a different status value here. Later edits to the
// screener never change what an already-minted run reports (spec.md
// "Pinned revision"): `screenerRevision` is the revision that was executed,
// permanently.
export interface ScreenerRun {
	runId: ResourceId;
	screenerId: ResourceId;
	screenerRevision: Revision;
	status: 'complete';
	// Instruments in the universe after liquidity limits and exclusions.
	universeCount: number;
	// Instruments satisfying the filter tree, before the result limit.
	matchedCount: number;
	// Matches actually stored in this run, after the result limit.
	returnedCount: number;
	truncated: boolean;
	// false when the screener had no ranking and the documented default
	// order was used instead (spec.md "No ranking").
	rankingApplied: boolean;
	// How weighted ranking fields were made comparable before combining, or
	// null when no ranking was applied. Percentile-rank within the matched
	// set is the documented default (spec.md Open Question 3); stating it
	// per run, rather than assuming callers know the engine's default,
	// keeps a composite score inspectable on its own.
	normalization: string | null;
	warnings: ScreenerWarning[];
	provenance: MarketDataProvenance;
	// Ordered by rank, ascending. The whole result set, not one page --
	// EPIC-1010 pages this after the fact; run.ts stores the complete list
	// so paging never re-executes (spec.md "Retrievable without rerun").
	matches: ScreenerMatch[];
	// Every universe instrument the run evaluated but did not return, keyed
	// by instrumentId -- see RejectedCandidate for why this covers both a
	// genuine filter-tree failure and a matched-but-truncated instrument.
	// Mutually exclusive with `matches` by construction (makeScreenerRun
	// enforces this): explain_result (EPIC-1010) tells "evaluated but
	// rejected" (AC4) apart from "outside the universe, never evaluated"
	// (AC5) by checking membership in `matches` union this map versus
	// neither.
	rejectedEvaluations: Record<string, RejectedCandidate>;
	// The exact filter tree and ranking configuration this run evaluated,
	// pinned alongside the outcome data. Neither is recoverable from
	// FilterNodeEvaluation alone (that carries a node's outcome, not its
	// operator/threshold or its place in the AND/OR/NOT structure), and the
	// *current* screener definition is not a safe substitute -- it can have
	// moved past this run's pinned revision, and even a still-retained past
	// revision lives under the workspace's own, separate revision-retention
	// policy rather than this run's RunRetentionPolicy. A pinned run must be
	// self-contained: explain_result (EPIC-1010) reads these directly off
	// this object, never through a second store.
	filterTree: FilterNode;
	rankingSpec: RankingSpec | null;
	// ISO-8601 instant the run was minted.
	createdAt: string;
}

// technical.md is explicit that a refused run "mints no run_id" when
// blocking validation problems prevent execution. Modeling refusal as this
// separate type -- rather than a `status: 'refused'` value living on
// ScreenerRun itself -- makes that structurally true instead of a
// convention a caller could get wrong: runId, provenance, matches and every
// other field a completed run carries simply do not exist on a refusal, so
// there is no field to misread as present-but-empty.
export interface ScreenerRunRefusal {
	status: 'refused';
	screenerId: ResourceId;
	screenerRevision: Revision;
	problems: ValidationProblem[];
}

// What `run_screener` returns: exactly one of a pinned run or a refusal.
// Callers branch on `status` to recover the concrete type.
export type ScreenerRunOutcome = ScreenerRun | ScreenerRunRefusal;

function isPlausibleProvenance(value: unknown): value is MarketDataProvenance {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const p = value as Record<string, unknown>;
	// Checks the fields every liveness arm of MarketDataProvenance shares
	// (see workbench/domain/provenance.ts's ProvenanceCore). This is a
	// shape check, not a full re-validation of the discriminated union --
	// its job is catching absence (a deserialized object with `provenance`
	// missing or `{}`), not re-deriving what makeProvenance already
	// guaranteed at construction time.
	return (
		typeof p.asOf === 'string' &&
		typeof p.sourceId === 'string' &&
		typeof p.sourceLabel === 'string' &&
		typeof p.liveness === 'string' &&
		typeof p.timezone === 'string' &&
		typeof p.engineVersion === 'string'
	);
}

// Builds a ScreenerRun, enforcing the invariants a hand-assembled or
// deserialized object could otherwise violate silently (AC4, AC5, AC6).
// This is a programming-error guard for T-1009-7's evaluation engine --
// callers are expected to construct from already-computed, trustworthy
// data, so a violation throws rather than returning a typed problem (that
// vocabulary is validation.ts's job, for data an agent supplied).
export function makeScreenerRun(input: ScreenerRun): ScreenerRun {
	if (!isPlausibleProvenance(input.provenance)) {
		throw new Error(
			'makeScreenerRun: provenance is required and must be a complete MarketDataProvenance record.'
		);
	}
	if (input.returnedCount !== input.matches.length) {
		throw new Error(
			`makeScreenerRun: returnedCount (${input.returnedCount}) must equal matches.length ` +
				`(${input.matches.length}).`
		);
	}
	const expectedTruncated = input.returnedCount < input.matchedCount;
	if (input.truncated !== expectedTruncated) {
		throw new Error(
			`makeScreenerRun: truncated (${input.truncated}) must equal ` +
				`returnedCount < matchedCount (${expectedTruncated}).`
		);
	}
	input.matches.forEach((match, index) => {
		const expectedRank = index + 1;
		if (match.rank !== expectedRank) {
			throw new Error(
				`makeScreenerRun: matches must be ranked contiguously from 1; expected rank ` +
					`${expectedRank} at position ${index}, got ${match.rank}.`
			);
		}
	});
	const matchedIds = new Set(input.matches.map((match) => match.instrumentId));
	const overlap = Object.keys(input.rejectedEvaluations).filter((id) => matchedIds.has(id));
	if (overlap.length > 0) {
		throw new Error(
			`makeScreenerRun: instrument(s) ${overlap.join(', ')} cannot appear in both matches and ` +
				`rejectedEvaluations -- a match and a rejection are mutually exclusive.`
		);
	}
	return { ...input, status: 'complete' };
}

// Keys whose value is undefined are dropped rather than written, matching
// workbench/domain/provenance.ts's toWireProvenance so an omitted optional
// stays genuinely absent on the wire instead of becoming an explicit null.
function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function toWireFilterNodeEvaluation(evaluation: FilterNodeEvaluation): Record<string, unknown> {
	return withoutUndefined({
		node_id: evaluation.nodeId,
		passed: evaluation.passed,
		value: evaluation.value,
		unit: evaluation.unit,
		detail: evaluation.detail,
		data_unavailable: evaluation.dataUnavailable
	});
}

function toWireNodeEvaluations(
	nodeEvaluations: Record<string, FilterNodeEvaluation>
): Record<string, unknown> {
	const wire: Record<string, unknown> = {};
	for (const [nodeId, evaluation] of Object.entries(nodeEvaluations)) {
		wire[nodeId] = toWireFilterNodeEvaluation(evaluation);
	}
	return wire;
}

function toWireRejectedCandidate(candidate: RejectedCandidate): Record<string, unknown> {
	return withoutUndefined({
		instrument_id: candidate.instrumentId,
		node_evaluations: toWireNodeEvaluations(candidate.nodeEvaluations),
		ranking_values: candidate.rankingValues
	});
}

function toWireWarning(warning: ScreenerWarning): Record<string, unknown> {
	return withoutUndefined({
		code: warning.code,
		message: warning.message,
		node_ids: warning.nodeIds
	});
}

// One of two serializers this module exports (the other is
// toWireScreenerRun). Exported on its own because EPIC-1010's paging tools
// serialize one page of matches at a time, never a whole run's match list
// in one payload.
export function toWireScreenerMatch(match: ScreenerMatch): Record<string, unknown> {
	return {
		instrument_id: match.instrumentId,
		rank: match.rank,
		composite_score: match.compositeScore,
		ranking_values: match.rankingValues,
		node_evaluations: toWireNodeEvaluations(match.nodeEvaluations)
	};
}

// The single snake_case serializer for a whole run, delegating to
// toWireProvenance so this module never re-implements provenance's wire
// shape. Deliberately excludes `filterTree`/`rankingSpec`: run_screener's
// caller already supplied that exact ScreenerDefinition as input, so
// echoing the whole filter tree back on every run_screener response would
// duplicate data the caller already has, for no consumer's benefit -- those
// two fields exist on ScreenerRun purely for explain_result (EPIC-1010) to
// read off the in-memory object.
export function toWireScreenerRun(run: ScreenerRun): Record<string, unknown> {
	const rejectedEvaluations: Record<string, unknown> = {};
	for (const [instrumentId, candidate] of Object.entries(run.rejectedEvaluations)) {
		rejectedEvaluations[instrumentId] = toWireRejectedCandidate(candidate);
	}
	return {
		run_id: run.runId,
		screener_id: run.screenerId,
		screener_revision: run.screenerRevision,
		status: run.status,
		universe_count: run.universeCount,
		matched_count: run.matchedCount,
		returned_count: run.returnedCount,
		truncated: run.truncated,
		ranking_applied: run.rankingApplied,
		normalization: run.normalization,
		warnings: run.warnings.map(toWireWarning),
		provenance: toWireProvenance(run.provenance),
		matches: run.matches.map(toWireScreenerMatch),
		rejected_evaluations: rejectedEvaluations,
		created_at: run.createdAt
	};
}
