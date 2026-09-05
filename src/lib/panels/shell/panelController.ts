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
	bindPanelSource,
	bindRunToResultsPanel,
	createPanel,
	configurePanelView,
	emptyPanelState,
	readPanelState,
	removePanel,
	renderedRects,
	resetLayout,
	type PanelSystemState,
	type PanelUseCaseDeps
} from '../application';
import { computeEmptyCells, type OccupiedRect } from '../domain/layout';
import { DEFAULT_SEED_PANELS } from '../domain/defaultLayout';
import type { PanelLinkChannel } from '../domain/channels';
import { propagationTargets, type PanelLinkGraph } from '../domain/links';
import type { GridPosition, GridRect } from '../domain/grid';
import type { Panel, PanelSourceRef } from '../domain/panel';
import type { PanelKindDefinition } from '../registry/panelKindRegistry';
import type { ToolSpec } from '../../webmcp/types';
import type { ScreenerEvaluationPort, PinnedRunStore } from '../../screener/ports';
import type { ScreenerRun, ScreenerRunOutcome } from '../../screener/run';
import { readScreener } from '../../screener/state';
import type { ScreenerDefinition } from '../../screener/definition';

// T-0027-2: the chart panel kind's own name -- spec.md item 11 and
// technical.md's "Amendment (EPIC-0027)" both specify that dropping a
// results row on an empty cell creates a *chart* panel, never a caller-
// chosen kind, so this is deliberately hardcoded rather than threaded
// through as a parameter.
const DROP_TARGET_PANEL_KIND = 'chart';

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

// The header's Reset control's use case: same shape as removePanelByHuman
// above (PanelContainer's own precedent for a human-triggered mutation) --
// calls the exact same resetLayout an agent's reset_layout tool call would,
// just tagged actor: 'human'.
export function resetLayoutByHuman(deps: PanelUseCaseDeps): MutationEnvelope {
	return resetLayout(deps, { context: { actor: 'human' } });
}

// ---------------------------------------------------------------------------
// Drag a result onto the canvas (T-0027-2)
// ---------------------------------------------------------------------------

// Rebinding an existing panel dropped onto -- calls the exact same
// bindPanelSource an agent's bind_panel_source tool call would (AC2, AC5),
// tagged actor: 'human' like every other human-triggered mutation in this
// module. Rejection (AC3: an incompatible target) is validateSource's own
// job inside bindPanelSource -- this throws the identical PanelOperationError
// a rejected agent call would, for the caller (PanelContainer.svelte) to
// catch and treat as "nothing changes."
export function bindPanelSourceFromDrop(
	deps: PanelUseCaseDeps,
	panelId: string,
	source: PanelSourceRef
): MutationEnvelope {
	return bindPanelSource(deps, { context: { actor: 'human' }, panelId, source });
}

// Creating a chart anchored at the dropped-on cell (AC1) -- calls the exact
// same createPanel an agent's create_panel tool call would, with one
// difference from every other createPanel call site in this module
// (seedDefaultWorkspace above): an explicit `rect`, anchored at the cell
// the human actually dropped onto rather than auto-placement
// (technical.md's own "Amendment (EPIC-0027)"). The rect's footprint is
// the chart kind's own `defaultSize` -- a bare 1x1 rect at the drop point
// would fail createPanel's own below_minimum check for a kind (chart) whose
// minSize is 2x2, and "the exact cell dropped on" means the panel's
// top-left corner lands there, not that the panel becomes 1x1.
//
// When the grid has no free cell anywhere (`occupied` covers every cell),
// `rect` is omitted instead of passed through, so this reuses createPanel's
// own auto-placement grid_full throw (support.ts's resolveAutoRect) rather
// than reporting the dropped-on cell as a mere overlap or out-of-bounds --
// the exact "grid is full" rejection AC4 documents, reused rather than
// reimplemented. A placement that fails only because the anchored footprint
// itself overlaps a panel or runs past the grid edge (while free space
// exists elsewhere) is rejected the same way an agent's out-of-bounds/
// overlapping create_panel call would be -- not silently relocated.
export function createChartFromDrop(
	deps: PanelUseCaseDeps,
	source: PanelSourceRef,
	anchor: GridPosition,
	occupied: OccupiedRect[]
): MutationEnvelope {
	// deps.kinds.require throws UnknownPanelKindError if 'chart' were somehow
	// never registered -- a wiring bug (every real composition root registers
	// it), not a state a human dragging a row can otherwise reach.
	const rect: GridRect = { ...anchor, ...deps.kinds.require(DROP_TARGET_PANEL_KIND).defaultSize };
	const gridIsFull = computeEmptyCells(occupied).length === 0;
	return createPanel(deps, {
		context: { actor: 'human' },
		kind: DROP_TARGET_PANEL_KIND,
		source,
		...(gridIsFull ? {} : { rect })
	});
}

// ---------------------------------------------------------------------------
// Human-triggered screener run (T-0020-11)
// ---------------------------------------------------------------------------

export interface RunScreenerByHumanDeps {
	useCaseDeps: PanelUseCaseDeps;
	evaluationPort: ScreenerEvaluationPort;
	runStore: PinnedRunStore;
}

export type RunScreenerByHumanResult =
	// AC: "when no screener is currently defined ... disabled with an
	// explanation rather than being clickable and failing" -- the button
	// itself stays disabled in that state (FilterBuilderPanel.svelte reads
	// doc.screenerId directly), so this is defense-in-depth for any other
	// caller (including this ticket's own tests) rather than the primary
	// guard a person actually hits.
	| { status: 'no_screener' }
	| { status: 'error'; message: string }
	| { status: 'ok'; outcome: ScreenerRunOutcome };

// Keyed by workspaceId, not by the caller's RunScreenerByHumanDeps object
// identity (post-review fix, EPIC-0020: the original WeakMap<deps, ...> was
// dead in production -- FilterBuilderPanel.svelte's handleRun() builds a
// fresh deps object literal on every call, so no two activations ever
// shared a key; only Svelte's synchronous `running` state was actually
// preventing a double-run). Concurrency is scoped per-workspace, which is
// also the semantically correct unit here regardless of which object
// happened to trigger the call -- a keyboard shortcut, a retry, or any
// future caller without a stable deps reference now gets the same real
// single-flight protection FilterBuilderPanel already relies on. A `Map`
// (not `WeakMap`) is required since a workspaceId string can't be weakly
// referenced; `.finally()` below still deletes the entry as soon as the run
// settles, so this never leaks an entry per workspace that ever ran once.
const humanRunsInFlight = new Map<string, Promise<RunScreenerByHumanResult>>();

// The screener definition currently active for a workspace, or null when
// none is defined -- split out of executeHumanRun so that function reads as
// a linear read -> evaluate -> react pipeline.
function resolveCurrentScreenerDefinition(
	useCaseDeps: PanelUseCaseDeps
): ScreenerDefinition | null {
	const doc = useCaseDeps.repository.get(useCaseDeps.workspaceId);
	const screenerId = doc?.screenerId;
	return doc && screenerId ? readScreener(doc, screenerId) : null;
}

// Best-effort pin + bind for a completed run, split out of executeHumanRun
// for the same reason as resolveCurrentScreenerDefinition above. Never
// throws: a binding failure must never turn an otherwise successful human
// run into a failure for the person who clicked Run.
function pinAndBindCompletedRun(
	useCaseDeps: PanelUseCaseDeps,
	runId: string,
	outcome: ScreenerRun,
	runStore: PinnedRunStore
): void {
	runStore.putRun(outcome);
	try {
		// T-0020-11's own wrinkle: bindRunToResultsPanel used to hardcode
		// actor: 'agent' -- now threaded through so this human-triggered
		// create-or-rebind (T-0020-10) records in the action log as
		// actor: 'human', matching every other human action in this module,
		// while execute()'s own tool-call path (runScreener.ts) still always
		// passes 'agent'.
		bindRunToResultsPanel(
			useCaseDeps,
			{
				kinds: useCaseDeps.kinds,
				sourceRenderer: useCaseDeps.sourceRenderer,
				templates: useCaseDeps.templates
			},
			useCaseDeps.workspaceId,
			runId,
			'human'
		);
	} catch (err) {
		// Best-effort, mirroring run_screener's own binding failure
		// handling (runScreener.ts): binding never turns an otherwise
		// successful run into a failure for the human who clicked Run.
		console.warn(
			'runScreenerByHuman: auto-bind to results_table panel failed (best-effort, run itself still succeeded)',
			err
		);
	}
}

async function executeHumanRun(deps: RunScreenerByHumanDeps): Promise<RunScreenerByHumanResult> {
	const { useCaseDeps, evaluationPort, runStore } = deps;
	const definition = resolveCurrentScreenerDefinition(useCaseDeps);
	if (!definition) {
		return { status: 'no_screener' };
	}

	const runId = useCaseDeps.ids.next('run');
	let outcome: ScreenerRunOutcome;
	try {
		outcome = await evaluationPort.execute({ definition, runId });
	} catch (err) {
		return { status: 'error', message: err instanceof Error ? err.message : String(err) };
	}

	if (outcome.status === 'complete') {
		pinAndBindCompletedRun(useCaseDeps, runId, outcome, runStore);
	}
	return { status: 'ok', outcome };
}

// The filter panel's "Run" control's use case (T-0020-11): calls the exact
// same evaluation/pin/bind pipeline run_screener's tool handler performs
// (ScreenerEvaluationPort.execute, PinnedRunStore.putRun, then T-0020-10's
// create-or-rebind), tagged actor: 'human', directly against typed
// arguments rather than round-tripping through run_screener's JSON tool-wire
// shape -- matching this module's own direct-use-case-call convention
// (readSnapshot, togglePanelCollapsed) instead of introducing a new one.
export function runScreenerByHuman(
	deps: RunScreenerByHumanDeps
): Promise<RunScreenerByHumanResult> {
	const key = deps.useCaseDeps.workspaceId;
	const inFlight = humanRunsInFlight.get(key);
	if (inFlight) {
		return inFlight;
	}
	const promise = executeHumanRun(deps).finally(() => humanRunsInFlight.delete(key));
	humanRunsInFlight.set(key, promise);
	return promise;
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
