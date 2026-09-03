// Everything worth unit-testing in the panel shell: workspace
// creation/loading, default-layout seeding, snapshot reading, panel-body
// resolution, tool-call notification, and linked-value propagation. The
// .svelte files in this directory are thin wiring over these functions,
// matching this codebase's existing split between untested wiring
// components and unit-tested logic modules.
import {
	recordCommit,
	undoChange,
	type ChangeHistory,
	type ChangeRecord
} from '../../workbench/application/changeHistory';
import type { RevisionService } from '../../workbench/application/revisionService';
import type { Clock, WorkspaceRepository } from '../../workbench/domain/ports';
import type { IdSequencer } from '../../workbench/domain/ids';
import type { MutationEnvelope } from '../../workbench/domain/mutation';
import { emptyWorkspace } from '../../workbench/domain/workspace';
import {
	createPanel,
	configurePanelView,
	emptyPanelState,
	readPanelState,
	removePanel,
	renderedRects,
	type PanelSystemState,
	type PanelUseCaseDeps
} from '../application';
import type { OccupiedRect } from '../domain/layout';
import type { GridRect } from '../domain/grid';
import type { PanelLinkChannel } from '../domain/channels';
import { propagationTargets, type PanelLinkGraph } from '../domain/links';
import type { Panel } from '../domain/panel';
import type { PanelKindDefinition } from '../registry/panelKindRegistry';
import type { ToolSpec } from '../../webmcp/types';

// ---------------------------------------------------------------------------
// Workspace initialization (T-1007-9's gate lives here)
// ---------------------------------------------------------------------------

export interface WorkspaceInfraDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	clock: Clock;
	ids: IdSequencer;
}

export interface WorkspaceInitResult {
	workspaceId: string;
	// True only when this call minted a brand-new workspace id -- never
	// derived from the resulting document's panel count. Loading, restoring,
	// or (if a future tool adds it) duplicating a workspace always yields
	// false here, even when the resulting state happens to have zero panels.
	justCreated: boolean;
}

// Mirrors workbench/tools/index.ts's create_workspace tool exactly (same
// recordCommit + emptyWorkspace call), without importing across the
// tool-wrapper boundary -- this is "the same createWorkspace contract",
// just invoked from this epic's composition root instead of through
// document.modelContext, per T-1007-9 AC5.
export function createNewWorkspace(
	deps: WorkspaceInfraDeps,
	name: string
): { workspaceId: string; envelope: MutationEnvelope } {
	const workspaceId = deps.ids.next('workspace');
	const envelope = recordCommit(
		{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
		{
			workspaceId,
			context: { actor: 'agent' },
			operationKind: 'workbench.create_workspace',
			requestInput: { name },
			mutate: () => ({
				document: emptyWorkspace(workspaceId, name, deps.clock.now()),
				affectedIds: [workspaceId],
				diffSummary: `Created workspace "${name}".`
			})
		}
	);
	deps.repository.setActiveId(workspaceId);
	return { workspaceId, envelope };
}

// The composition root's entry point: reuse the active workspace if one
// exists, otherwise create a fresh one. This is the one and only place
// `justCreated: true` can come from.
export function initializeWorkspace(
	deps: WorkspaceInfraDeps,
	defaultName = 'Workbench'
): WorkspaceInitResult {
	const activeId = deps.repository.getActiveId();
	if (activeId && deps.repository.get(activeId)) {
		return { workspaceId: activeId, justCreated: false };
	}
	const { workspaceId } = createNewWorkspace(deps, defaultName);
	return { workspaceId, justCreated: true };
}

// Loading a specific, already-known workspace id is never a creation event,
// regardless of what it currently contains.
export function loadWorkspace(workspaceId: string): WorkspaceInitResult {
	return { workspaceId, justCreated: false };
}

// ---------------------------------------------------------------------------
// Default workspace seeding (T-1007-9)
// ---------------------------------------------------------------------------

interface SeedPanelSpec {
	kind: string;
	rect: GridRect;
}

// T-1015-12: the full six-panel target composition, per the user's own
// reference mockup (docs/plan/project.md's 2026-09-02 arrangement note) --
// screener logic left, chart with studies center, similar-setups sidebar
// right, watchlist and alert-draft bottom right, results table bottom. Every
// rect below is >= its kind's own minSize (never its defaultSize, which
// would not fit six panels on one fixed 6x4 grid) and the six exactly tile
// the grid with no gaps or overlaps:
//   col 0-1, row 0-3: filter_builder (full-height, left)
//   col 2-4, row 0-1: chart (center, top)
//   col   5, row 0-1: similar_opportunities (sidebar, right)
//   col 2-4, row 2-3: results_table (center, bottom)
//   col   5, row   2: watchlist (bottom right)
//   col   5, row   3: alert_draft (bottom right)
const DEFAULT_SEED_PANELS: readonly SeedPanelSpec[] = [
	{ kind: 'filter_builder', rect: { col: 0, row: 0, colSpan: 2, rowSpan: 4 } },
	{ kind: 'chart', rect: { col: 2, row: 0, colSpan: 3, rowSpan: 2 } },
	{ kind: 'similar_opportunities', rect: { col: 5, row: 0, colSpan: 1, rowSpan: 2 } },
	{ kind: 'results_table', rect: { col: 2, row: 2, colSpan: 3, rowSpan: 2 } },
	{ kind: 'watchlist', rect: { col: 5, row: 2, colSpan: 1, rowSpan: 1 } },
	{ kind: 'alert_draft', rect: { col: 5, row: 3, colSpan: 1, rowSpan: 1 } }
];

// Uses the exact same createPanel use case every other panel-creation path
// uses -- no bespoke construction. No `source` is passed, so each seeded
// panel comes out exactly as a bare create_panel({kind}) call would: source
// null, whichever renderer the kind's own defaultRenderer specifies.
export function seedDefaultWorkspace(
	deps: PanelUseCaseDeps,
	justCreated: boolean
): MutationEnvelope[] {
	if (!justCreated) {
		return [];
	}
	return DEFAULT_SEED_PANELS.map((spec) =>
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: spec.kind,
			rect: spec.rect
		})
	);
}

// ---------------------------------------------------------------------------
// Reading rendered state
// ---------------------------------------------------------------------------

export interface PanelSnapshot {
	workspaceId: string;
	state: PanelSystemState;
	maximizedId: string | null;
	rects: OccupiedRect[];
}

export function readSnapshot(
	deps: Pick<PanelUseCaseDeps, 'workspaceId' | 'repository'>,
	maximizedId: string | null
): PanelSnapshot {
	const doc = deps.repository.get(deps.workspaceId);
	const state = doc ? readPanelState(doc) : emptyPanelState();
	return {
		workspaceId: deps.workspaceId,
		state,
		maximizedId,
		rects: renderedRects(state.panels, maximizedId)
	};
}

// ---------------------------------------------------------------------------
// Panel body resolution (AC2, AC9)
// ---------------------------------------------------------------------------

// The per-instance data a REAL, kind-specific body receives -- exactly
// PlaceholderPanelBody's own prop shape minus `kindDefinition` (redundant
// there: a real body already knows its own kind statically at registration
// time, unlike the generic placeholder, which needs it to render an
// arbitrary kind's dl/broadcast form). `onBroadcast` is included for parity
// with every future sibling kind even though this epic's own panel doesn't
// need it (T-1010-6's setPanelSelection already implements real
// selection-propagation over the link graph; this prop is only the
// same-page, client-render-only manual broadcast channel placeholders use
// for testing) -- withholding it selectively would make this fix
// results-specific instead of generic.
export interface PanelBodyProps {
	panel: Panel;
	linkedValue?: LinkedValueEntry;
	// Returns whether the broadcast actually reached at least one linked
	// panel (bug fix, see git history) -- a body that shows the human its own
	// feedback (PlaceholderPanelBody's "no linked recipients" state) needs
	// this to distinguish a real send from a no-op.
	onBroadcast: (channel: PanelLinkChannel, value: string) => boolean;
}

// `component` is always the normalized, directly-renderable function -- a
// bare-function load is used as-is, a { default: fn } module load is
// unwrapped -- so the Svelte layer never has to repeat that check.
export type ResolvedPanelBody =
	| { kind: 'component'; component: (props: PanelBodyProps) => unknown }
	| { kind: 'placeholder' }
	| { kind: 'error'; message: string };

function normalizeComponent(value: unknown): ((props: PanelBodyProps) => unknown) | null {
	if (typeof value === 'function') {
		return value as (props: PanelBodyProps) => unknown;
	}
	if (typeof value === 'object' && value !== null) {
		const withDefault = (value as { default?: unknown }).default;
		if (typeof withDefault === 'function') {
			return withDefault as (props: PanelBodyProps) => unknown;
		}
	}
	return null;
}

// Every EPIC-1007 placeholder kind resolves to a plain marker object
// ({ placeholderKind }), which is neither a function nor { default: fn }, so
// every shipped kind falls through to 'placeholder' today -- a sibling epic
// registering a kind whose component() resolves to a real component starts
// taking the 'component' branch with no change here. A throwing or
// rejecting loader is caught and contained to this one panel (AC9); it never
// propagates past this function.
export async function resolvePanelBody(
	definition: Pick<PanelKindDefinition, 'component'>
): Promise<ResolvedPanelBody> {
	try {
		const loaded = await definition.component();
		const component = normalizeComponent(loaded);
		return component ? { kind: 'component', component } : { kind: 'placeholder' };
	} catch (err) {
		return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
	}
}

// ---------------------------------------------------------------------------
// Re-render notification (AC5, AC8)
// ---------------------------------------------------------------------------

export interface PanelWorkspaceObserver {
	subscribe(listener: () => void): () => void;
	notify(): void;
}

// A tool call (agent-driven) and a direct use-case call from a UI control
// (human-driven) both end up calling notify() through this one object, so
// PanelContainer has exactly one thing to subscribe to regardless of who
// triggered the change -- rendering derives entirely from workspace state,
// re-read fresh on every notification.
export function createPanelWorkspaceObserver(): PanelWorkspaceObserver {
	const listeners = new Set<() => void>();
	return {
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		notify(): void {
			for (const listener of listeners) {
				listener();
			}
		}
	};
}

// Wraps every tool's execute so a successful (or failed -- a failed call can
// still have partially advanced idempotency/undo bookkeeping worth
// reflecting) call notifies observers afterward, without editing panelTools.ts.
export function wrapToolsWithNotify(
	tools: ToolSpec[],
	observer: PanelWorkspaceObserver
): ToolSpec[] {
	return tools.map((tool) => ({
		...tool,
		execute: async (input: unknown) => {
			const result = await tool.execute(input);
			observer.notify();
			return result;
		}
	}));
}

// ---------------------------------------------------------------------------
// Linked-value propagation (AC6)
// ---------------------------------------------------------------------------

export interface LinkedValueEntry {
	channel: PanelLinkChannel;
	value: unknown;
}

export type LinkedValues = Record<string, LinkedValueEntry>;

// Client-render state layered over the link graph, the same shape as
// `maximized`: never a workspace mutation. Every placeholder body receives
// whatever arrived for its own panel id through one uniform prop and decides
// for itself what to do with it (here: display it) -- the container itself
// only computes *who* receives the value via propagationTargets, never
// branching on any panel's kind.
export function propagateLinkedValue(
	graph: PanelLinkGraph,
	channel: PanelLinkChannel,
	sourcePanelId: string,
	value: unknown,
	current: LinkedValues
): { next: LinkedValues; targets: string[] } {
	const targets = propagationTargets(graph, channel, sourcePanelId);
	const next = { ...current };
	for (const targetId of targets) {
		next[targetId] = { channel, value };
	}
	return { next, targets };
}

// ---------------------------------------------------------------------------
// Human-facing chrome actions (collapse affordance, undo)
// ---------------------------------------------------------------------------

export function togglePanelCollapsed(
	deps: PanelUseCaseDeps,
	panelId: string,
	collapsed: boolean
): MutationEnvelope {
	return configurePanelView(deps, { context: { actor: 'agent' }, panelId, collapsed });
}

// The close affordance's use case (T-1015-10 AC1): calls the exact same
// removePanel an agent tool call would, just tagged actor: 'human' -- same
// shape as togglePanelCollapsed above (PanelContainer's handler calls this
// then refresh()). removePanel never inspects who created the panel, so
// closing an agent-created panel takes this identical path (AC4).
export function removePanelByHuman(deps: PanelUseCaseDeps, panelId: string): MutationEnvelope {
	return removePanel(deps, { context: { actor: 'human' }, panelId });
}

// Read-only access to the change log for the shell's action-log icon
// (T-1015-10 AC3) -- calls ChangeHistory.list directly, mirroring this
// module's existing direct-use-case-call convention (readSnapshot,
// togglePanelCollapsed) rather than round-tripping through
// get_change_history's tool wire format client-side.
export function readActionLog(
	deps: Pick<PanelUseCaseDeps, 'history' | 'workspaceId'>,
	limit?: number
): ChangeRecord[] {
	return deps.history.list(deps.workspaceId, { limit });
}

// Reuses EPIC-1006's undoChange directly (no reimplementation) so redeeming
// an undo token through the shell re-renders through the same read path as
// every other mutation (AC8).
export function undoPanelChange(
	deps: Pick<PanelUseCaseDeps, 'history' | 'revisions' | 'clock'>,
	undoToken: string
): MutationEnvelope {
	return undoChange(undoToken, {
		history: deps.history,
		revisionService: deps.revisions,
		clock: deps.clock,
		context: { actor: 'agent' }
	});
}
