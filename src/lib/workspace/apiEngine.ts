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
// from a browser-side cache of full backend InstanceSets this engine keeps
// alongside the store (WorkspaceState.instanceSets only carries summaries,
// for UI purposes -- see types.ts). The cache is persisted so charts can
// render again after reloads.
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
	type ShowTickerChartsInput,
	type SplitInstancesInput,
	type StudySummary,
	type WorkspaceState
} from '../webmcp/types';

// Backend JSON shapes (snake_case, matching the Pydantic domain models in
// backend/domain/models/ directly -- see api/schemas/research.py). Exported
// (not just used internally) because T-1001-7's grid/chart components need
// the full instance set -- not just the InstanceSetSummary in
// WorkspaceState -- to call fetchInstanceWindows below; see this module's
// header comment and getBackendInstanceSet.
export interface BackendInstance {
	ticker: string;
	date: string;
	completeness: number;
}

export interface BackendInstanceSet {
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

// domain/models/price.py's PriceBar -- field names already match camelCase
// 1:1 (single-word fields), so no snake_case mapping is needed here unlike
// the other Backend* shapes above.
export interface BackendPriceBar {
	ticker: string;
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

// domain/models/measurement.py's InstanceWindow. Deliberately carries only
// `ticker`, not the instance's own date/completeness -- see
// pairWithInstances below for how the UI recovers those.
interface BackendInstanceWindow {
	ticker: string;
	bars: BackendPriceBar[];
}

// A window paired back up with the instance metadata (date, completeness)
// the grid/chart/histogram components need -- InstanceWindow itself doesn't
// carry either (see BackendInstanceWindow above).
export interface InstanceWindowView {
	ticker: string;
	date: string;
	completeness?: number;
	bars: BackendPriceBar[];
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

const INSTANCE_SET_CACHE_KEY = 'webmcp-backend-instance-sets';

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

// Keyed by the exact ResearchEngine object createApiEngine returns, so
// chart components can reach a given engine's browser-side instanceSetCache
// without adding methods to the ResearchEngine interface itself -- that
// interface is the WebMCP tool contract and T-1001-7 must leave it
// unchanged (see this module's header comment and the ticket's
// "data-fetching gap" note). WeakMaps rather than fields on the returned
// object keep ResearchEngine's own shape exactly as T-1001-5 shipped it.
const instanceSetCacheByEngine = new WeakMap<ResearchEngine, Map<string, BackendInstanceSet>>();
const instanceSetResolverByEngine = new WeakMap<
	ResearchEngine,
	(instanceSetId: string) => Promise<BackendInstanceSet | undefined>
>();

// UI-only escape hatch for T-1001-7's grid/chart/histogram components: they
// only have a PanelSummary/InstanceSetSummary (from WorkspaceState) to work
// from, but fetchInstanceWindows below needs the full BackendInstanceSet
// (concrete instance list) the same way showGrid/measure/etc. do internally.
export function getBackendInstanceSet(
	engine: ResearchEngine,
	instanceSetId: string
): BackendInstanceSet | undefined {
	return instanceSetCacheByEngine.get(engine)?.get(instanceSetId);
}

export async function resolveBackendInstanceSet(
	engine: ResearchEngine,
	instanceSetId: string
): Promise<BackendInstanceSet | undefined> {
	const cached = getBackendInstanceSet(engine, instanceSetId);
	if (cached) {
		return cached;
	}
	return instanceSetResolverByEngine.get(engine)?.(instanceSetId);
}

function readInstanceSetCache(storage: Storage | undefined): Map<string, BackendInstanceSet> {
	if (!storage) {
		return new Map();
	}
	const raw = storage.getItem(INSTANCE_SET_CACHE_KEY);
	if (!raw) {
		return new Map();
	}
	try {
		const sets = JSON.parse(raw) as BackendInstanceSet[];
		return new Map(sets.filter((set) => typeof set?.id === 'string').map((set) => [set.id, set]));
	} catch {
		return new Map();
	}
}

function writeInstanceSetCache(
	storage: Storage | undefined,
	cache: Map<string, BackendInstanceSet>
): void {
	storage?.setItem(INSTANCE_SET_CACHE_KEY, JSON.stringify([...cache.values()]));
}

// InstanceWindow (see BackendInstanceWindow above) carries only `ticker` --
// not the instance's date or completeness the grid/histogram need (anchor
// alignment, partial-instance display). get_instance_windows samples
// internally with this same n/strategy, so the windows come back in the
// same order sample_instances would have produced them; consuming each
// ticker's instances in that order (via the per-ticker queue below)
// recovers the pairing without the backend contract having to change.
function pairWithInstances(
	instances: BackendInstance[],
	windows: BackendInstanceWindow[]
): InstanceWindowView[] {
	const byTicker = new Map<string, BackendInstance[]>();
	for (const inst of instances) {
		const bucket = byTicker.get(inst.ticker);
		if (bucket) {
			bucket.push(inst);
		} else {
			byTicker.set(inst.ticker, [inst]);
		}
	}
	return windows.map((w) => {
		const inst = byTicker.get(w.ticker)?.shift();
		return {
			ticker: w.ticker,
			date: inst?.date ?? '',
			completeness: inst?.completeness,
			bars: w.bars
		};
	});
}

// The UI-only fetch T-1001-7 needs to actually render a panel: showGrid
// (above) only returns a bare PanelSummary handle to the agent -- correct
// for the WebMCP tool contract, but it means grid/chart/histogram
// components must fetch the bar data themselves, independent of whichever
// tool call created the panel. Reuses the same POST-JSON pattern as this
// module's internal post() (see createApiEngine below), but as a
// standalone function since it doesn't need that closure's store/mutate
// access -- it's pure data fetching for rendering, not a workspace mutation.
export async function fetchInstanceWindows(
	config: ApiClientConfig,
	instanceSet: BackendInstanceSet,
	n?: number,
	strategy?: 'random' | 'recent' | 'best' | 'worst',
	window?: [number, number]
): Promise<InstanceWindowView[]> {
	const response = await fetch(`${config.baseUrl}/api/research/instance-windows`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ instance_set: instanceSet, n, strategy, window })
	});
	if (!response.ok) {
		throw new Error(`research backend returned ${response.status}: ${response.statusText}`);
	}
	const windows = (await response.json()) as BackendInstanceWindow[];
	return pairWithInstances(instanceSet.instances, windows);
}

export function createApiEngine(
	store: Writable<WorkspaceState>,
	config: ApiClientConfig
): ResearchEngine {
	const cacheStorage =
		config.instanceSetStorage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
	const existingIds = workspaceIds(get(store));
	let nextId =
		Math.max(0, ...existingIds.map((existingId) => Number(existingId.match(/_(\d+)$/)?.[1] ?? 0))) +
		1;
	const id = (prefix: string) => `${prefix}_${nextId++}`;
	// Full backend InstanceSets (with the concrete instance list), keyed by
	// id -- see the module header comment for why this can't just be read
	// back out of WorkspaceState.
	const instanceSetCache = readInstanceSetCache(cacheStorage);

	function uniqueId(prefix: string, preferred: string): string {
		const used = new Set([...workspaceIds(get(store)), ...instanceSetCache.keys()]);
		if (!used.has(preferred)) {
			return preferred;
		}
		let candidate = id(prefix);
		while (used.has(candidate)) {
			candidate = id(prefix);
		}
		return candidate;
	}

	function rememberInstanceSet(set: BackendInstanceSet): void {
		instanceSetCache.set(set.id, set);
		writeInstanceSetCache(cacheStorage, instanceSetCache);
	}

	function appendInstanceSetSummary(summary: InstanceSetSummary): void {
		mutate((ws) => {
			const existingIndex = ws.instanceSets.findIndex((set) => set.id === summary.id);
			if (existingIndex >= 0) {
				ws.instanceSets[existingIndex] = summary;
			} else {
				ws.instanceSets.push(summary);
			}
		});
	}

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

	const engine: ResearchEngine = {
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
			result.id = uniqueId('set', result.id);
			rememberInstanceSet(result);
			const summary = toSummary(result);
			appendInstanceSetSummary(summary);
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
				set.id = uniqueId('set', set.id);
				rememberInstanceSet(set);
			}
			const summaries = results.map(toSummary);
			for (const summary of summaries) {
				appendInstanceSetSummary(summary);
			}
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
				instanceSetId: input.instanceSetId,
				n: input.n,
				strategy: input.strategy,
				window: input.window
			};
			mutate((ws) => ws.panels.push(panel));
			return panel;
		},
		async showTickerCharts(input: ShowTickerChartsInput): Promise<PanelSummary> {
			const tickers = input.tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
			if (tickers.length === 0) {
				throw new Error('At least one ticker is required');
			}
			const set: BackendInstanceSet = {
				id: uniqueId('set', id('set')),
				setup_id: 'manual_ticker_chart',
				instances: tickers.map((ticker) => ({
					ticker,
					date: input.date,
					completeness: 1
				})),
				complete_count: tickers.length,
				partial_count: 0,
				from_date: input.date,
				to_date: input.date
			};
			rememberInstanceSet(set);
			appendInstanceSetSummary(toSummary(set));
			const panel: PanelSummary = {
				id: id('panel'),
				kind: 'grid',
				instanceSetId: set.id,
				title: input.title ?? `${tickers.join(', ')} monthly chart`,
				n: tickers.length,
				strategy: 'recent',
				window: input.window ?? [-20, 0]
			};
			mutate((ws) => ws.panels.push(panel));
			return panel;
		},
		async clearPanels(): Promise<WorkspaceState> {
			mutate((ws) => {
				ws.panels = [];
				ws.focus = null;
			});
			return get(store);
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
	instanceSetCacheByEngine.set(engine, instanceSetCache);
	instanceSetResolverByEngine.set(engine, async (instanceSetId: string) => {
		const cached = instanceSetCache.get(instanceSetId);
		if (cached) {
			return cached;
		}
		const ws = get(store);
		const summary = ws.instanceSets.find((set) => set.id === instanceSetId);
		const setup = ws.setups.find((item) => item.id === summary?.setupId);
		if (!summary || !setup || summary.parentId) {
			return undefined;
		}
		const result = await post<BackendInstanceSet>('/api/research/find-instances', {
			setup: { id: setup.id, name: setup.name, steps: setup.steps },
			studies: knownStudies(),
			from_date: summary.from,
			to_date: summary.to
		});
		result.id = summary.id;
		result.setup_id = summary.setupId;
		rememberInstanceSet(result);
		return result;
	});
	return engine;
}

function workspaceIds(ws: WorkspaceState): string[] {
	return [
		...ws.studies.map((item) => item.id),
		...ws.setups.map((item) => item.id),
		...ws.instanceSets.map((item) => item.id),
		...ws.panels.map((item) => item.id)
	];
}
