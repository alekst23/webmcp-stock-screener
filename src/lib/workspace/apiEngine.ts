// Real ResearchEngine (T-1001-5): defineStudy/defineSetup/getWorkspace/
// focusInstance run purely in-memory client-side (per docs/plan.md's
// client/server split); findInstances/sampleInstances/measure/
// splitInstances/showGrid call the FastAPI backend built in
// backend/api/routes/research.py. Supersedes devEngine.ts (T-1001-6's
// explicit stand-in for this ticket).
//
// The backend is stateless per request (docs/plan.md's "Sessions" section):
// defineStudy/defineSetup never touch the network, so the server has no
// record of a setup or instance set by id. Every networked call therefore
// sends the full setup/instance-set data by value, sourced either from the
// workspace store (studies/setups, which already have the right shape) or
// from a private cache of full backend InstanceSets this engine keeps
// alongside the store (WorkspaceState.instanceSets only carries summaries,
// for UI purposes -- see types.ts).
import { get, type Writable } from 'svelte/store';
import {
	ExpressionError,
	FUNCTION_CATALOG,
	type ApiClientConfig,
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
	type SetupStep,
	type SetupSummary,
	type ShowGridInput,
	type SplitInstancesInput,
	type StudySummary,
	type WorkspaceState
} from '../webmcp/types';

// Backend JSON shapes (snake_case, matching the Pydantic domain models in
// backend/domain/models/ directly -- see api/schemas/research.py).
interface BackendInstance {
	ticker: string;
	date: string;
	completeness: number;
}

interface BackendInstanceSet {
	id: string;
	setup_id: string;
	instances: BackendInstance[];
	complete_count: number;
	partial_count: number;
	from_date: string;
	to_date: string;
	parent_id?: string | null;
	label?: string | null;
}

interface BackendMeasureResult {
	metric: string;
	horizon_days: number;
	count: number;
	median: number;
	mean: number;
	hit_rate: number;
	base_rate?: { median: number; hit_rate: number } | null;
	excluded_partial_count?: number | null;
}

interface BackendStudy {
	id: string;
	name: string;
	expression: string;
}

// Every function call in `expression` must name a FUNCTION_CATALOG entry.
// Deliberately shallow (name-only, not real parsing) per this ticket's
// resolved design in the ticket doc -- the backend's infra/expression.py
// owns real validation (arity, operators, undefined names).
function assertKnownFunctions(expression: string): void {
	const calls = expression.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\(/g);
	for (const [, name] of calls) {
		// The capture group always participates when the outer pattern
		// matches; the `?? ''` only satisfies TS's regex-match typing.
		if (!FUNCTION_CATALOG.includes(name ?? '')) {
			throw new ExpressionError(`Unknown function "${name}"`, FUNCTION_CATALOG);
		}
	}
}

function assertStepsUseKnownFunctions(steps: SetupStep[]): void {
	for (const step of steps) {
		assertKnownFunctions(step.condition);
	}
}

function toSummary(set: BackendInstanceSet): InstanceSetSummary {
	return {
		id: set.id,
		setupId: set.setup_id,
		count: set.instances.length,
		completeCount: set.complete_count,
		partialCount: set.partial_count,
		from: set.from_date,
		to: set.to_date,
		parentId: set.parent_id ?? undefined,
		label: set.label ?? undefined
	};
}

function toInstanceEvent(inst: BackendInstance): InstanceEvent {
	return { ticker: inst.ticker, date: inst.date, completeness: inst.completeness };
}

function toMeasureResult(result: BackendMeasureResult): MeasureResult {
	return {
		metric: result.metric,
		horizonDays: result.horizon_days,
		count: result.count,
		median: result.median,
		mean: result.mean,
		hitRate: result.hit_rate,
		baseRate: result.base_rate
			? { median: result.base_rate.median, hitRate: result.base_rate.hit_rate }
			: undefined,
		excludedPartialCount: result.excluded_partial_count ?? undefined
	};
}

export function createApiEngine(
	store: Writable<WorkspaceState>,
	config: ApiClientConfig
): ResearchEngine {
	let nextId = 1;
	const id = (prefix: string) => `${prefix}_${nextId++}`;
	// Full backend InstanceSets (with the concrete instance list), keyed by
	// id -- see the module header comment for why this can't just be read
	// back out of WorkspaceState.
	const instanceSetCache = new Map<string, BackendInstanceSet>();

	function mutate(fn: (ws: WorkspaceState) => void): void {
		store.update((ws) => {
			fn(ws);
			return ws;
		});
	}

	function requireSetup(setupId: string): SetupSummary {
		const setup = get(store).setups.find((s) => s.id === setupId);
		if (!setup) {
			throw new Error(`Unknown setupId "${setupId}"`);
		}
		return setup;
	}

	function requireInstanceSet(instanceSetId: string): BackendInstanceSet {
		const set = instanceSetCache.get(instanceSetId);
		if (!set) {
			throw new Error(`Unknown instanceSetId "${instanceSetId}"`);
		}
		return set;
	}

	function knownStudies(): BackendStudy[] {
		return get(store).studies.map((s) => ({ id: s.id, name: s.name, expression: s.expression }));
	}

	async function post<T>(path: string, body: unknown): Promise<T> {
		const response = await fetch(`${config.baseUrl}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			throw await toRequestError(response);
		}
		return (await response.json()) as T;
	}

	async function toRequestError(response: Response): Promise<Error> {
		const payload = (await response.json().catch(() => null)) as {
			detail?: { message?: string; catalog?: string[] } | string;
		} | null;
		const detail = payload?.detail;
		if (detail && typeof detail === 'object' && Array.isArray(detail.catalog)) {
			return new ExpressionError(detail.message ?? 'invalid expression', detail.catalog);
		}
		const message = typeof detail === 'string' ? detail : response.statusText;
		return new Error(`research backend returned ${response.status}: ${message}`);
	}

	return {
		async defineStudy(input: DefineStudyInput): Promise<StudySummary> {
			assertKnownFunctions(input.expression);
			const study: StudySummary = { id: id('study'), ...input };
			mutate((ws) => ws.studies.push(study));
			return study;
		},
		async defineSetup(input: DefineSetupInput): Promise<SetupSummary> {
			assertStepsUseKnownFunctions(input.steps);
			const setup: SetupSummary = { id: id('setup'), ...input };
			mutate((ws) => ws.setups.push(setup));
			return setup;
		},
		async findInstances(input: FindInstancesInput): Promise<InstanceSetSummary> {
			const setup = requireSetup(input.setupId);
			const result = await post<BackendInstanceSet>('/api/research/find-instances', {
				setup: { id: setup.id, name: setup.name, steps: setup.steps },
				studies: knownStudies(),
				from_date: input.from,
				to_date: input.to,
				min_market_cap: input.universe?.minMarketCap,
				sectors: input.universe?.sectors
			});
			instanceSetCache.set(result.id, result);
			const summary = toSummary(result);
			mutate((ws) => ws.instanceSets.push(summary));
			return summary;
		},
		async sampleInstances(input: SampleInstancesInput): Promise<InstanceEvent[]> {
			const instanceSet = requireInstanceSet(input.instanceSetId);
			const result = await post<BackendInstance[]>('/api/research/sample-instances', {
				instance_set: instanceSet,
				n: input.n,
				strategy: input.strategy,
				horizon_days: input.horizonDays
			});
			return result.map(toInstanceEvent);
		},
		async measure(input: MeasureInput): Promise<MeasureResult> {
			const instanceSet = requireInstanceSet(input.instanceSetId);
			const result = await post<BackendMeasureResult>('/api/research/measure', {
				instance_set: instanceSet,
				horizon_days: input.horizonDays,
				metric: input.metric,
				compare_to_base_rate: input.compareToBaseRate ?? true
			});
			return toMeasureResult(result);
		},
		async splitInstances(input: SplitInstancesInput): Promise<InstanceSetSummary[]> {
			const instanceSet = requireInstanceSet(input.instanceSetId);
			const results = await post<BackendInstanceSet[]>('/api/research/split-instances', {
				instance_set: instanceSet,
				mode: input.mode,
				studies: knownStudies(),
				expression: input.expression,
				horizon_days: input.horizonDays,
				threshold: input.threshold
			});
			for (const set of results) {
				instanceSetCache.set(set.id, set);
			}
			const summaries = results.map(toSummary);
			mutate((ws) => ws.instanceSets.push(...summaries));
			return summaries;
		},
		async showGrid(input: ShowGridInput): Promise<PanelSummary> {
			const instanceSet = requireInstanceSet(input.instanceSetId);
			// Validates the set resolves and materializes windows server-side;
			// rendering the returned bars is T-1001-7's job, not this tool's --
			// showGrid's contract only promises a PanelSummary back to the agent.
			await post('/api/research/instance-windows', {
				instance_set: instanceSet,
				n: input.n,
				strategy: input.strategy,
				window: input.window
			});
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
				// focusInstance is agent-driven and only ever moves
				// focusedInstance -- it must not touch the human's hand-picked
				// selection (types.ts's FocusState.selected).
				ws.focus = {
					panelId,
					selected: ws.focus?.selected ?? [],
					focusedInstance: { ticker: input.ticker, date: input.date }
				};
			});
		},
		async getWorkspace(): Promise<WorkspaceState> {
			return get(store);
		}
	};
}
