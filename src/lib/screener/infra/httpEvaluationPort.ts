// HttpScreenerEvaluationPort (T-0026-4): implements ScreenerEvaluationPort
// against the real backend endpoint EPIC-0025 shipped -- POST /api/screener/
// run -- replacing the in-browser engine's honest-unavailable default
// (createUnavailableMarketData) as run_screener's actual runtime data
// source. Mirrors workspace/panelStatus.ts's / chart/infra/httpChartSeries.ts's
// established fetch -> check .ok -> parse JSON -> map convention, not a new
// HTTP style.
//
// validate() and execute() both POST to the same endpoint (dry_run: true vs
// false) -- ports.ts requires both on one port for exactly this reason: a
// browser-computed validation must never be able to disagree with what
// execute() actually ran against the same backend.
//
// Infra layer: implements the domain port (ports.ts); domain code does not
// import this file.

import type { RelativeBaseline, Condition, SeriesRef } from '../conditions';
import type {
	FilterNode,
	RankingField,
	RankingSpec,
	ScreenerDefinition
} from '../definition';
import type { ScreenerEvaluationPort } from '../ports';
import {
	makeScreenerRun,
	type FilterNodeEvaluation,
	type ScreenerMatch,
	type ScreenerRun,
	type ScreenerRunOutcome,
	type ScreenerRunRefusal
} from '../run';
import type { ScreenerValidationReport, ValidationProblem } from '../validation';
import {
	makeProvenance,
	type MarketDataProvenance,
	type PriceAdjustment,
	type ProvenanceLiveness
} from '../../workbench/domain/provenance';

const RUN_PATH = '/api/screener/run';

// A blocking problem code this module owns (not one of validation.ts's
// PROBLEM_CODES) -- it names a transport/contract failure, not a screener
// authoring mistake, so it must not be confused with the backend's own
// vocabulary.
const NETWORK_ERROR_CODE = 'network_error';

// --- Outbound wire shapes (backend/domain/models/screener.py,
// backend/domain/models/screener_run.py) ---------------------------------

interface WireSeriesRef {
	catalog_id: string;
	params: Record<string, string | number | boolean>;
}

interface WireFilterNodeBase {
	node_id: string;
	enabled: boolean;
}

interface WireConditionNode extends WireFilterNodeBase {
	kind: 'condition';
	condition: Record<string, unknown>;
}

interface WireGroupNode extends WireFilterNodeBase {
	kind: 'group';
	op: 'and' | 'or' | 'not';
	children: WireFilterNode[];
}

type WireFilterNode = WireConditionNode | WireGroupNode;

interface WireUniverseSpec {
	universe_id: string;
	label: string;
	sectors?: string[];
	min_price?: number | null;
	min_avg_volume?: number | null;
	min_market_cap?: number | null;
	excluded_tickers: string[];
}

interface WireRankingField {
	field_id: string;
	direction: 'asc' | 'desc';
	weight: number;
}

interface WireRankingSpec {
	fields: WireRankingField[];
	tie_break?: WireRankingField;
	normalization: string;
}

interface WireScreenerRunRequest {
	universe: WireUniverseSpec;
	filter_tree: WireFilterNode;
	ranking?: WireRankingSpec;
	limit: number;
	dry_run: boolean;
}

// --- Inbound wire shapes ---------------------------------------------------

interface WireValidationProblem {
	severity: 'blocking' | 'advisory';
	code: string;
	message: string;
	node_ids: string[];
	universe_criteria: string[];
}

interface WireFilterNodeEvaluation {
	node_id: string;
	passed: boolean;
	value: number | string | boolean | null;
	unit?: string | null;
	detail?: string | null;
	data_unavailable?: boolean;
}

interface WireInstrumentRef {
	instrument_id: string;
	symbol: string;
	exchange?: string | null;
	asset_type?: string | null;
}

interface WireScreenerMatch {
	instrument: WireInstrumentRef;
	rank: number;
	composite_score: number;
	ranking_values: Record<string, number | null>;
	node_evaluations: Record<string, WireFilterNodeEvaluation>;
}

interface WireMarketDataProvenance {
	as_of: string;
	source_id: string;
	source_label: string;
	liveness: ProvenanceLiveness;
	delay_seconds?: number | null;
	timezone: string;
	currency?: string | null;
	price_adjustment?: PriceAdjustment | null;
	engine_version: string;
}

interface WireScreenerRunResult {
	status: 'complete' | 'refused' | 'valid';
	as_of: string;
	universe_count: number;
	matched_count: number;
	returned_count: number;
	truncated: boolean;
	ranking_applied: boolean;
	matches: WireScreenerMatch[];
	problems: WireValidationProblem[];
	provenance?: WireMarketDataProvenance | null;
}

// --- Request builders --------------------------------------------------

function toWireSeriesRef(ref: SeriesRef): WireSeriesRef {
	return { catalog_id: ref.catalogId, params: ref.params };
}

function toWireRelativeBaseline(baseline: RelativeBaseline): Record<string, unknown> {
	if (baseline.kind === 'peer_group') {
		return { kind: 'peer_group', group_id: baseline.groupId };
	}
	if (baseline.kind === 'index') {
		return { kind: 'index', index_id: baseline.indexId };
	}
	return { kind: 'own_moving_average', window_bars: baseline.windowBars };
}

// Field-for-field mirror of backend/domain/models/screener.py's Condition
// union, which is itself documented as a field-for-field mirror of this
// file's own conditions.ts -- see that Python module's header.
function toWireCondition(condition: Condition): Record<string, unknown> {
	switch (condition.type) {
		case 'scalar':
			return {
				type: 'scalar',
				field_id: condition.fieldId,
				operator: condition.operator,
				value: condition.value,
				unit: condition.unit
			};
		case 'range':
			return {
				type: 'range',
				field_id: condition.fieldId,
				lower: condition.lower,
				upper: condition.upper,
				lower_inclusive: condition.lowerInclusive,
				upper_inclusive: condition.upperInclusive
			};
		case 'series_comparison':
			return {
				type: 'series_comparison',
				left: toWireSeriesRef(condition.left),
				right: toWireSeriesRef(condition.right),
				operator: condition.operator
			};
		case 'temporal':
			return {
				type: 'temporal',
				condition: toWireCondition(condition.condition),
				event: condition.event,
				within_bars: condition.withinBars,
				interval_id: condition.intervalId
			};
		case 'event_relative':
			return {
				type: 'event_relative',
				event_type_id: condition.eventTypeId,
				direction: condition.direction,
				window_days: condition.windowDays
			};
		case 'pattern':
			return {
				type: 'pattern',
				pattern_id: condition.patternId,
				min_confidence: condition.minConfidence,
				interval_id: condition.intervalId
			};
		case 'relative':
			return {
				type: 'relative',
				field_id: condition.fieldId,
				baseline: toWireRelativeBaseline(condition.baseline),
				multiple: condition.multiple,
				operator: condition.operator
			};
		case 'study_output':
			return {
				type: 'study_output',
				study_id: condition.studyId,
				params: condition.params,
				output_name: condition.outputName,
				predicate: condition.predicate
			};
	}
}

function toWireFilterNode(node: FilterNode): WireFilterNode {
	if (node.kind === 'group') {
		return {
			node_id: node.nodeId,
			kind: 'group',
			op: node.op,
			children: node.children.map(toWireFilterNode),
			enabled: node.enabled
		};
	}
	return {
		node_id: node.nodeId,
		kind: 'condition',
		condition: toWireCondition(node.condition),
		enabled: node.enabled
	};
}

function toWireRankingField(field: RankingField): WireRankingField {
	return { field_id: field.fieldId, direction: field.direction, weight: field.weight };
}

// The backend's UniverseSpec is deliberately smaller than the frontend's
// (no exchanges/countries/industries/indexes/watchlists -- its own
// docstring says the Python side classifies none of those yet), so those
// fields are simply not sent rather than forced into a lossy mapping.
// `universe_id`/`label` are required by the backend model but never
// filtered on there -- filled from the screener's own id/name so the
// request is well-formed.
function toWireUniverse(definition: ScreenerDefinition): WireUniverseSpec {
	const { universe } = definition;
	return {
		universe_id: definition.screenerId,
		label: definition.name ?? definition.screenerId,
		sectors: universe.sectors,
		min_price: universe.liquidity.minPrice,
		min_avg_volume: universe.liquidity.minAverageVolume,
		min_market_cap: universe.liquidity.minMarketCap,
		excluded_tickers: universe.exclusions.instrumentIds
	};
}

function toWireRanking(ranking: RankingSpec | null): WireRankingSpec | undefined {
	if (!ranking) {
		return undefined;
	}
	return {
		fields: ranking.fields.map(toWireRankingField),
		tie_break: ranking.tieBreak
			? { field_id: ranking.tieBreak.fieldId, direction: ranking.tieBreak.direction, weight: 1 }
			: undefined,
		normalization: ranking.normalization
	};
}

const DEFAULT_LIMIT = 50;

function buildRequest(definition: ScreenerDefinition, dryRun: boolean): WireScreenerRunRequest {
	return {
		universe: toWireUniverse(definition),
		filter_tree: toWireFilterNode(definition.filterTree),
		ranking: toWireRanking(definition.ranking),
		limit: definition.ranking?.limit ?? DEFAULT_LIMIT,
		dry_run: dryRun
	};
}

// --- Response mappers ----------------------------------------------------

function fromWireProblem(problem: WireValidationProblem): ValidationProblem {
	return {
		severity: problem.severity,
		code: problem.code,
		nodeIds: problem.node_ids,
		universeCriteria: problem.universe_criteria,
		message: problem.message
	};
}

function fromWireFilterNodeEvaluation(evaluation: WireFilterNodeEvaluation): FilterNodeEvaluation {
	return {
		nodeId: evaluation.node_id,
		passed: evaluation.passed,
		value: evaluation.value,
		unit: evaluation.unit ?? undefined,
		detail: evaluation.detail ?? undefined,
		dataUnavailable: evaluation.data_unavailable ?? undefined
	};
}

function fromWireNodeEvaluations(
	nodeEvaluations: Record<string, WireFilterNodeEvaluation>
): Record<string, FilterNodeEvaluation> {
	const out: Record<string, FilterNodeEvaluation> = {};
	for (const [nodeId, evaluation] of Object.entries(nodeEvaluations)) {
		out[nodeId] = fromWireFilterNodeEvaluation(evaluation);
	}
	return out;
}

// Maps only the fields the backend's ScreenerMatch and the frontend's
// ScreenerMatch (run.ts) both already carry -- T-0026-3 owns widening
// ScreenerMatch's own shape, not this ticket.
function fromWireMatch(match: WireScreenerMatch): ScreenerMatch {
	return {
		instrumentId: match.instrument.instrument_id,
		rank: match.rank,
		compositeScore: match.composite_score,
		rankingValues: match.ranking_values,
		nodeEvaluations: fromWireNodeEvaluations(match.node_evaluations)
	};
}

function fromWireProvenance(provenance: WireMarketDataProvenance): MarketDataProvenance {
	const core = {
		asOf: provenance.as_of,
		sourceId: provenance.source_id,
		sourceLabel: provenance.source_label,
		timezone: provenance.timezone,
		currency: provenance.currency ?? undefined,
		priceAdjustment: provenance.price_adjustment ?? undefined
	};
	if (provenance.liveness === 'delayed') {
		return makeProvenance({
			...core,
			liveness: 'delayed',
			delaySeconds: provenance.delay_seconds ?? 0
		});
	}
	return makeProvenance({ ...core, liveness: provenance.liveness });
}

function networkProblem(message: string): ValidationProblem {
	return { severity: 'blocking', code: NETWORK_ERROR_CODE, nodeIds: [], universeCriteria: [], message };
}

function readableErrorMessage(err: unknown): string {
	const detail = err instanceof Error ? err.message : 'unknown error';
	return `Screener evaluation request to the backend failed: ${detail}`;
}

function toRefusal(definition: ScreenerDefinition, problems: ValidationProblem[]): ScreenerRunRefusal {
	return {
		status: 'refused',
		screenerId: definition.screenerId,
		screenerRevision: definition.revision,
		problems
	};
}

// AC5: a network failure, a non-2xx response, or a malformed 'complete'
// body (no provenance) never escapes as a thrown error -- it becomes a
// readable refusal, exactly like a backend-reported blocking problem does.
function refusalFromError(definition: ScreenerDefinition, err: unknown): ScreenerRunRefusal {
	return toRefusal(definition, [networkProblem(readableErrorMessage(err))]);
}

function toCompleteRun(
	input: { definition: ScreenerDefinition; runId: string },
	body: WireScreenerRunResult,
	now: Date
): ScreenerRun {
	if (!body.provenance) {
		throw new Error('the backend reported a complete run with no provenance.');
	}
	return makeScreenerRun({
		runId: input.runId,
		screenerId: input.definition.screenerId,
		screenerRevision: input.definition.revision,
		status: 'complete',
		universeCount: body.universe_count,
		matchedCount: body.matched_count,
		returnedCount: body.returned_count,
		truncated: body.truncated,
		rankingApplied: body.ranking_applied,
		// The backend reports whether ranking was applied, not the
		// normalization basis used -- that's the request's own RankingSpec,
		// echoed back rather than fabricated when ranking was in fact applied.
		normalization: body.ranking_applied ? (input.definition.ranking?.normalization ?? null) : null,
		warnings: [],
		provenance: fromWireProvenance(body.provenance),
		matches: body.matches.map(fromWireMatch),
		// The backend response carries no per-instrument rejection detail
		// (T-0026-4's scope is the evaluation port, not widening the wire
		// contract) -- honestly empty rather than fabricated.
		rejectedEvaluations: {},
		filterTree: input.definition.filterTree,
		rankingSpec: input.definition.ranking,
		createdAt: now.toISOString()
	});
}

// --- Port -------------------------------------------------------------

export interface HttpScreenerEvaluationPortDeps {
	baseUrl: string;
	fetchImpl?: typeof fetch;
	// Injectable for deterministic tests (ScreenerRun.createdAt); defaults
	// to the wall clock.
	now?: () => Date;
}

interface ResolvedDeps {
	baseUrl: string;
	fetchImpl: typeof fetch;
	now: () => Date;
}

async function postRun(deps: ResolvedDeps, body: WireScreenerRunRequest): Promise<WireScreenerRunResult> {
	const response = await deps.fetchImpl(`${deps.baseUrl}${RUN_PATH}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(`screener backend returned ${response.status}${detail ? `: ${detail}` : ''}`);
	}
	return (await response.json()) as WireScreenerRunResult;
}

async function execute(
	deps: ResolvedDeps,
	input: { definition: ScreenerDefinition; runId: string }
): Promise<ScreenerRunOutcome> {
	let body: WireScreenerRunResult;
	try {
		body = await postRun(deps, buildRequest(input.definition, false));
	} catch (err) {
		return refusalFromError(input.definition, err);
	}
	if (body.status !== 'complete') {
		// 'refused' maps directly; an unexpected 'valid' (this was not a
		// dry_run) is treated the same honest way -- the backend's own
		// reported problems are surfaced, never silently upgraded to a run.
		return toRefusal(input.definition, body.problems.map(fromWireProblem));
	}
	try {
		return toCompleteRun(input, body, deps.now());
	} catch (err) {
		return refusalFromError(input.definition, err);
	}
}

async function validate(
	deps: ResolvedDeps,
	definition: ScreenerDefinition
): Promise<ScreenerValidationReport> {
	let body: WireScreenerRunResult;
	try {
		body = await postRun(deps, buildRequest(definition, true));
	} catch (err) {
		return {
			screenerId: definition.screenerId,
			screenerRevision: definition.revision,
			valid: false,
			problems: [networkProblem(readableErrorMessage(err))],
			skippedNodeIds: [],
			costEstimate: null,
			detectionExhaustive: false
		};
	}
	// AC2: every reported problem is surfaced, not just the first.
	const problems = body.problems.map(fromWireProblem);
	return {
		screenerId: definition.screenerId,
		screenerRevision: definition.revision,
		valid: body.status === 'valid',
		problems,
		skippedNodeIds: [],
		costEstimate: null,
		detectionExhaustive: false
	};
}

export function createHttpScreenerEvaluationPort(
	deps: HttpScreenerEvaluationPortDeps
): ScreenerEvaluationPort {
	const resolved: ResolvedDeps = {
		baseUrl: deps.baseUrl,
		fetchImpl: deps.fetchImpl ?? fetch,
		now: deps.now ?? (() => new Date())
	};
	return {
		validate: (definition) => validate(resolved, definition),
		execute: (input) => execute(resolved, input)
	};
}
