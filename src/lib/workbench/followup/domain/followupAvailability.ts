// T-1014-11 AC2: which of the five follow-up tools with a workspace-wide
// prerequisite are usable right now. Pure domain -- no I/O. The composition
// root (registerAllFollowupTools.ts) gathers the snapshot from the live
// repository/run store and wraps each gated tool's execute with the check
// this module returns, so an agent gets a distinct "unavailable" result
// instead of the tool's own generic not_found/validation failure.
//
// None of the underlying ToolSpecs do this themselves -- every one hard-codes
// `available: () => true` (see e.g. deriveFiltersFromSetup.ts,
// refineSimilaritySearch.ts). That field is also legacy-shaped
// (`(ws: WorkspaceState) => boolean` against the *old* 11-tool surface) and
// `document.modelContext.registerTool` never reads it, so real gating for
// the new surface has to live here rather than being inherited.

export type FollowupPrerequisite =
	'screener' | 'pinned_run' | 'captured_setup' | 'similarity_search';

export interface FollowupAvailabilitySnapshot {
	hasScreener: boolean;
	hasPinnedRun: boolean;
	hasCapturedSetup: boolean;
	hasSimilaritySearch: boolean;
}

export interface UnmetPrerequisite {
	prerequisite: FollowupPrerequisite;
	message: string;
}

const MESSAGES: Record<FollowupPrerequisite, string> = {
	screener:
		'No screener exists in this workspace yet. Create one with create_screener before calling ' +
		'this tool.',
	pinned_run:
		'No pinned screener run exists in this workspace yet. Call run_screener before calling this ' +
		'tool.',
	captured_setup:
		'No captured chart setup exists in this workspace yet. Call capture_chart_setup before ' +
		'calling this tool.',
	similarity_search:
		'No similarity search exists in this workspace yet. Call find_similar_setups before calling ' +
		'this tool.'
};

// The five tools this ticket gates, and which prerequisite each depends on.
// `derive_filters_from_setup` only depends on a captured setup for its
// default/"derive" operation -- "edit" and "accept" act on an existing
// draft, which is a per-call not_found concern, not a surface-wide gate.
const GATED_TOOL_NAMES = new Set([
	'backtest_screener',
	'save_results_to_watchlist',
	'export_results',
	'derive_filters_from_setup',
	'refine_similarity_search'
]);

export function isGatedFollowupTool(toolName: string): boolean {
	return GATED_TOOL_NAMES.has(toolName);
}

function deriveOperation(input: unknown): string {
	if (typeof input !== 'object' || input === null) {
		return 'derive';
	}
	const operation = (input as { operation?: unknown }).operation;
	return typeof operation === 'string' ? operation : 'derive';
}

// Returns the unmet prerequisite for this call, or null when the tool is
// available. Never throws -- an unknown tool name (not one of the five
// gated names) is always available, since it has no prerequisite this
// module knows about.
export function unmetFollowupPrerequisite(
	toolName: string,
	input: unknown,
	snapshot: FollowupAvailabilitySnapshot
): UnmetPrerequisite | null {
	function unmet(prerequisite: FollowupPrerequisite): UnmetPrerequisite {
		return { prerequisite, message: MESSAGES[prerequisite] };
	}

	switch (toolName) {
		case 'backtest_screener':
			return snapshot.hasScreener ? null : unmet('screener');
		case 'save_results_to_watchlist':
		case 'export_results':
			return snapshot.hasPinnedRun ? null : unmet('pinned_run');
		case 'derive_filters_from_setup':
			return deriveOperation(input) === 'derive' && !snapshot.hasCapturedSetup
				? unmet('captured_setup')
				: null;
		case 'refine_similarity_search':
			return snapshot.hasSimilaritySearch ? null : unmet('similarity_search');
		default:
			return null;
	}
}
