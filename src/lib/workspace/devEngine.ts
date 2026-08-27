// Placeholder ResearchEngine for local development and the dev control
// surface (src/routes/dev). T-1001-5 replaces this with a real fetch-based
// ResearchEngine wired to the FastAPI backend built in T-1001-2/3/4 — this
// in-memory implementation exists solely so the tool surface from
// buildTools() (src/lib/webmcp/tools.ts) can be exercised end-to-end before
// a real WebMCP-capable browser or backend is available. Mirrors the fake
// used in src/lib/webmcp/tools.test.ts, but mutates the shared workspace
// store directly instead of a private object, so a manual tool call updates
// the same state view an agent would see.
import { get, type Writable } from 'svelte/store';
import {
	ExpressionError,
	type DefineSetupInput,
	type DefineStudyInput,
	type FindInstancesInput,
	type FocusInstanceInput,
	type InstanceEvent,
	type InstanceSetSummary,
	type MeasureInput,
	type MeasureResult,
	type PanelSummary,
	type ResearchEngine,
	type SampleInstancesInput,
	type SetupSummary,
	type ShowGridInput,
	type SplitInstancesInput,
	type StudySummary,
	type WorkspaceState
} from '../webmcp/types';

// Mirrors the function catalog used to validate expressions in
// tools.test.ts's fake engine — synchronous validation without a network
// round trip, per the client-side tool split in docs/plan.md.
const CATALOG = ['sma', 'ema', 'atr', 'highest', 'lowest', 'days_since'];

export function createDevEngine(store: Writable<WorkspaceState>): ResearchEngine {
	let nextId = 1;
	const id = (prefix: string) => `${prefix}_${nextId++}`;

	function mutate(fn: (ws: WorkspaceState) => void): void {
		store.update((ws) => {
			fn(ws);
			return ws;
		});
	}

	return {
		async defineStudy(input: DefineStudyInput): Promise<StudySummary> {
			const fn = input.expression.match(/([a-z_]+)\(/)?.[1];
			if (fn !== undefined && !CATALOG.includes(fn)) {
				throw new ExpressionError(`Unknown function "${fn}"`, CATALOG);
			}
			const study: StudySummary = { id: id('study'), ...input };
			mutate((ws) => ws.studies.push(study));
			return study;
		},
		async defineSetup(input: DefineSetupInput): Promise<SetupSummary> {
			const setup: SetupSummary = { id: id('setup'), ...input };
			mutate((ws) => ws.setups.push(setup));
			return setup;
		},
		async findInstances(input: FindInstancesInput): Promise<InstanceSetSummary> {
			const set: InstanceSetSummary = {
				id: id('set'),
				setupId: input.setupId,
				count: 42,
				from: input.from ?? '2015-01-02',
				to: input.to ?? '2026-08-25'
			};
			mutate((ws) => ws.instanceSets.push(set));
			return set;
		},
		async sampleInstances(_input: SampleInstancesInput): Promise<InstanceEvent[]> {
			return [{ ticker: 'ACME', date: '2024-03-08' }];
		},
		async measure(input: MeasureInput): Promise<MeasureResult> {
			return {
				metric: input.metric ?? 'fwd_return',
				horizonDays: input.horizonDays,
				count: 42,
				median: 0.02,
				mean: 0.03,
				hitRate: 0.6
			};
		},
		async splitInstances(_input: SplitInstancesInput): Promise<InstanceSetSummary[]> {
			return [];
		},
		async showGrid(input: ShowGridInput): Promise<PanelSummary> {
			const panel: PanelSummary = {
				id: id('panel'),
				kind: 'grid',
				instanceSetId: input.instanceSetId
			};
			mutate((ws) => ws.panels.push(panel));
			return panel;
		},
		async focusInstance(input: FocusInstanceInput): Promise<void> {
			mutate((ws) => {
				const panelId = input.panelId ?? ws.panels[ws.panels.length - 1]?.id ?? '';
				// focusInstance is agent-driven and only ever moves the focused
				// panel — it must not silently clear the human's hand-picked
				// selection (types.ts's FocusState.selected).
				ws.focus = { panelId, selected: ws.focus?.selected ?? [] };
			});
		},
		async getWorkspace(): Promise<WorkspaceState> {
			return get(store);
		}
	};
}
