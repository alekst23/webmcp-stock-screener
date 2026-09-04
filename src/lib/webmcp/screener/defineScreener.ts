// `define_screener` (T-0026-1): one payload -- universe, conditions
// (filter tree), ranking, limit -- that creates or fully replaces a
// screener's definition, validating everything together before committing
// anything (AC4, AC7). Absorbs the domain logic of create_screener,
// set_screener_universe, edit_filter_tree, set_screener_ranking and
// validate_screener: their filter-tree validation
// (screenerValidation.ts's validateScreenerDefinition), ranking
// normalization (screener/ranking.ts's validateRankingDeclaration) and
// universe resolution (universeValidation.ts's checkUniverseCatalogMembership)
// are reused; their five-tool boundary is not. Targets the workspace's
// current screener by default via WorkspaceDocument.screenerId (AC1/AC2).
//
// Two build passes over the same wire payload, both through the same pure
// builders (screenerDefinitionBuilder.ts, granularityApproximation.ts):
// a dry run against placeholder node ids that only collects problems (never
// touches the repository or the real IdSequencer), and -- only once that
// dry run is clean -- a second, synchronous pass inside recordCommit's
// mutate() that mints real ids and actually writes the definition. This is
// what makes AC7's "never a partial commit" true even though validation
// itself is async (needs the market-data port) while RevisionService.commit's
// mutate() callback is not.

import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import type {
	FilterNode,
	RankingSpec,
	ScreenerDefinition,
	UniverseSpec
} from '../../screener/definition';
import {
	approximateGranularity,
	type GranularityApproximation
} from '../../screener/granularityApproximation';
import type { ScreenerMarketData } from '../../screener/ports';
import { buildFilterTree, type NodeIdFactory } from '../../screener/screenerDefinitionBuilder';
import { validateScreenerDefinition } from '../../screener/screenerValidation';
import { readScreener, writeScreener } from '../../screener/state';
import type { ValidationProblem } from '../../screener/validation';
import { recordCommit } from '../../workbench/application/changeHistory';
import type { MutationDraft } from '../../workbench/application/revisionService';
import { OperationValidationError } from '../../workbench/domain/errors';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { WorkspaceDocument } from '../../workbench/domain/workspace';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { fail, ok } from '../toolResult';
import type { ToolResult, ToolSpec } from '../types';
import { buildRankingSpec } from './defineScreenerRanking';
import { DEFINE_SCREENER_DESCRIPTION, DEFINE_SCREENER_INPUT_SCHEMA } from './defineScreenerSchema';
import { buildUniverseAndCheckIndexes } from './defineScreenerUniverse';
import {
	readOptionalNumber,
	readOptionalString,
	resolveWorkspaceId,
	toErrorResult
} from './support';

export interface DefineScreenerDeps extends WorkbenchDeps {
	catalog?: CatalogRegistry;
	// Undefined means the honest "cannot resolve" default (ports.ts):
	// availability/empty-universe checks degrade to advisory rather than
	// claiming a false answer, matching validate_screener's own convention.
	marketData?: ScreenerMarketData;
	costBudget?: number;
}

interface DefineScreenerWireInput {
	workspace_id?: unknown;
	screener_id?: unknown;
	name?: unknown;
	universe?: unknown;
	conditions?: unknown;
	ranking?: unknown;
	limit?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function granularityWarningText(note: GranularityApproximation): string {
	return (
		`Node ${note.nodeId}: requested interval "${note.requestedIntervalId}" is not available; ` +
		`approximated using "${note.usedIntervalId}" instead.`
	);
}

interface DefinitionParts {
	universe: UniverseSpec;
	filterTree: FilterNode;
	ranking: RankingSpec | null;
	problems: ValidationProblem[];
	warnings: string[];
}

// The one synchronous "build everything but the market-data check" step,
// shared verbatim by the dry run and the real commit -- only the
// NodeIdFactory differs between the two calls.
function buildDefinitionParts(
	input: DefineScreenerWireInput,
	nextNodeId: NodeIdFactory,
	registry: CatalogRegistry
): DefinitionParts {
	const problems: ValidationProblem[] = [];
	const warnings: string[] = [];

	const universe = buildUniverseAndCheckIndexes(input.universe, registry, problems, warnings);

	let filterTree = buildFilterTree(input.conditions, nextNodeId, problems);
	const approximation = approximateGranularity(filterTree, registry);
	filterTree = approximation.tree;
	warnings.push(...approximation.approximations.map(granularityWarningText));

	const ranking = buildRankingSpec(input.ranking, input.limit, registry, problems);

	return { universe, filterTree, ranking, problems, warnings };
}

function nameOf(input: DefineScreenerWireInput): string | null {
	return typeof input.name === 'string' && input.name.length > 0 ? input.name : null;
}

function toWireProblem(p: ValidationProblem): Record<string, unknown> {
	return {
		severity: p.severity,
		code: p.code,
		node_ids: p.nodeIds,
		universe_criteria: p.universeCriteria,
		message: p.message
	};
}

type TargetResolution =
	| { kind: 'create' }
	| { kind: 'replace'; screenerId: string; priorRevision: number }
	// Only for an explicit screener_id absent from the workspace (AC3) --
	// caught before any build/validate work happens.
	| { kind: 'unknown'; screenerId: string };

function resolveTarget(
	doc: WorkspaceDocument,
	explicitScreenerId: string | null
): TargetResolution {
	if (explicitScreenerId) {
		const existing = readScreener(doc, explicitScreenerId);
		return existing
			? { kind: 'replace', screenerId: explicitScreenerId, priorRevision: existing.revision }
			: { kind: 'unknown', screenerId: explicitScreenerId };
	}
	const current = doc.screenerId ? readScreener(doc, doc.screenerId) : null;
	return current
		? { kind: 'replace', screenerId: doc.screenerId as string, priorRevision: current.revision }
		: { kind: 'create' };
}

// Disposable and call-local: these ids never reach the repository or the
// real IdSequencer, so a fresh counter per call is enough -- they only need
// to be unique within one response.
function placeholderIdFactory(): NodeIdFactory {
	let n = 0;
	return () => `pending_${++n}`;
}

// The real, synchronous build+write step run inside recordCommit's mutate()
// -- re-resolves the target against the freshest document (freshDoc may
// differ from the one the dry run validated against if another change
// landed during this call's async pre-check) rather than trusting the
// pre-check's snapshot, matching every sibling screener tool's mutate()
// convention.
function mutateDefinition(
	freshDoc: WorkspaceDocument,
	deps: DefineScreenerDeps,
	registry: CatalogRegistry,
	input: DefineScreenerWireInput,
	explicitScreenerId: string | null
): MutationDraft {
	const target = resolveTarget(freshDoc, explicitScreenerId);
	if (target.kind === 'unknown') {
		throw new OperationValidationError([`Unknown screener id: ${target.screenerId}.`]);
	}
	const screenerId = target.kind === 'replace' ? target.screenerId : deps.ids.next('screener');
	const revision = target.kind === 'replace' ? target.priorRevision + 1 : 1;

	const parts = buildDefinitionParts(input, () => deps.ids.next('filter'), registry);
	const definition: ScreenerDefinition = {
		screenerId,
		workspaceId: freshDoc.id,
		name: nameOf(input),
		revision,
		universe: parts.universe,
		filterTree: parts.filterTree,
		ranking: parts.ranking
	};

	const written = writeScreener(freshDoc, definition);
	const document = target.kind === 'create' ? { ...written, screenerId } : written;
	const label =
		target.kind === 'create'
			? `Created screener ${screenerId}`
			: `Redefined screener ${screenerId}`;

	return {
		document,
		affectedIds: [screenerId],
		diffSummary: `${label} (revision ${revision}).`,
		warnings: parts.warnings,
		inverse: {
			document: freshDoc,
			affectedIds: [screenerId],
			diffSummary:
				target.kind === 'create'
					? `Removed screener ${screenerId}.`
					: `Reverted screener ${screenerId} to its prior definition.`
		}
	};
}

// The async pre-check: builds the same candidate definition with
// placeholder ids and asks screenerValidation.ts's validateScreenerDefinition
// to check it against the catalog and (when configured) real market data --
// unknown catalog ids, out-of-range parameters, availability, contradictions,
// cost, and an empty-resolving universe (AC4) all come back from that one
// call. Never touches the repository or IdSequencer.
async function precheck(
	input: DefineScreenerWireInput,
	target: TargetResolution,
	workspaceId: string,
	deps: DefineScreenerDeps,
	registry: CatalogRegistry
): Promise<{ problems: ValidationProblem[]; warnings: string[] }> {
	const parts = buildDefinitionParts(input, placeholderIdFactory(), registry);
	const candidate: ScreenerDefinition = {
		screenerId: target.kind === 'replace' ? target.screenerId : 'screener_pending',
		workspaceId,
		name: nameOf(input),
		revision: target.kind === 'replace' ? target.priorRevision + 1 : 1,
		universe: parts.universe,
		filterTree: parts.filterTree,
		ranking: parts.ranking
	};
	const report = await validateScreenerDefinition(candidate, {
		registry,
		marketData: deps.marketData,
		costBudget: deps.costBudget
	});
	return { problems: [...parts.problems, ...report.problems], warnings: parts.warnings };
}

function isValid(problems: ValidationProblem[]): boolean {
	return problems.every((p) => p.severity !== 'blocking');
}

async function execute(deps: DefineScreenerDeps, rawInput: unknown): Promise<ToolResult> {
	const input = (rawInput ?? {}) as DefineScreenerWireInput;
	const registry = deps.catalog ?? builtinCatalogRegistry;

	const workspaceId = resolveWorkspaceId(deps, input);
	if (!workspaceId) {
		return fail('No active workspace.', { error: 'not_found' });
	}
	const doc = deps.repository.get(workspaceId);
	if (!doc) {
		return fail(`Workspace not found: ${workspaceId}`, { error: 'not_found' });
	}

	const explicitScreenerId =
		typeof input.screener_id === 'string' && input.screener_id.length > 0
			? input.screener_id
			: null;
	const target = resolveTarget(doc, explicitScreenerId);
	if (target.kind === 'unknown') {
		// `error` deliberately carries the human message, not a machine code:
		// a code here (matching fail()'s `{error: message, ...extra}` spread)
		// would clobber the message AC3 requires ("naming the unrecognized
		// id") the same way an `extra.error` would anywhere else in this
		// program -- see set_screener_ranking.ts's own note on this.
		return fail(`Unknown screener id: ${target.screenerId}.`, { screener_id: target.screenerId });
	}

	const { problems, warnings } = await precheck(input, target, workspaceId, deps, registry);
	if (!isValid(problems)) {
		const message = 'The screener definition has problems and was not saved.';
		return fail(message, {
			error: 'validation_failed',
			message,
			screener_id: target.kind === 'replace' ? target.screenerId : null,
			valid: false,
			problems: problems.map(toWireProblem),
			warnings
		});
	}

	try {
		const envelope = recordCommit(
			{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
			{
				workspaceId,
				context: {
					expectedRevision: readOptionalNumber(input.expected_revision),
					idempotencyKey: readOptionalString(input.idempotency_key),
					actor: 'agent'
				},
				operationKind: 'screener.define_screener',
				requestInput: input,
				mutate: (freshDoc) => mutateDefinition(freshDoc, deps, registry, input, explicitScreenerId)
			}
		);
		const resultDoc = deps.repository.get(workspaceId);
		const resultScreenerId = envelope.affectedIds[0] ?? null;
		const resultScreener =
			resultDoc && resultScreenerId ? readScreener(resultDoc, resultScreenerId) : null;
		return ok({
			...toWireEnvelope(envelope),
			screener_id: resultScreenerId,
			screener_revision: resultScreener?.revision ?? null,
			valid: true
		});
	} catch (err) {
		return toErrorResult(err);
	}
}

export function createDefineScreenerTool(deps: DefineScreenerDeps): ToolSpec {
	return {
		name: 'define_screener',
		description: DEFINE_SCREENER_DESCRIPTION,
		inputSchema: DEFINE_SCREENER_INPUT_SCHEMA,
		available: () => true,
		execute: (input) => execute(deps, input)
	};
}
