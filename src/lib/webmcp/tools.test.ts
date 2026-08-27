import { describe, expect, it } from 'vitest';
import { buildTools } from './tools';
import {
	ExpressionError,
	type DefineSetupInput,
	type DefineStudyInput,
	type FindInstancesInput,
	type InstanceSetSummary,
	type ResearchEngine,
	type SetupSummary,
	type StudySummary,
	type WorkspaceState
} from './types';

const CATALOG = ['sma', 'ema', 'atr', 'highest', 'lowest', 'days_since'];

// In-memory fake with real registry behavior: ids are handed out sequentially
// and getWorkspace reflects everything defined so far.
function fakeEngine(): ResearchEngine {
	const ws: WorkspaceState = { studies: [], setups: [], instanceSets: [], panels: [], focus: null };
	let nextId = 1;
	const id = (prefix: string) => `${prefix}_${nextId++}`;

	return {
		async defineStudy(input: DefineStudyInput): Promise<StudySummary> {
			const fn = input.expression.match(/([a-z_]+)\(/)?.[1];
			if (fn !== undefined && !CATALOG.includes(fn)) {
				throw new ExpressionError(`Unknown function "${fn}"`, CATALOG);
			}
			const study = { id: id('study'), ...input };
			ws.studies.push(study);
			return study;
		},
		async defineSetup(input: DefineSetupInput): Promise<SetupSummary> {
			const setup = { id: id('setup'), ...input };
			ws.setups.push(setup);
			return setup;
		},
		async findInstances(input: FindInstancesInput): Promise<InstanceSetSummary> {
			const set = {
				id: id('set'),
				setupId: input.setupId,
				count: 42,
				completeCount: 42,
				partialCount: 0,
				from: '2015-01-02',
				to: '2026-08-25'
			};
			ws.instanceSets.push(set);
			return set;
		},
		async sampleInstances() {
			return [{ ticker: 'ACME', date: '2024-03-08' }];
		},
		async measure() {
			return { metric: 'fwd_return', horizonDays: 10, count: 42, median: 0.02, mean: 0.03, hitRate: 0.6 };
		},
		async splitInstances() {
			return [];
		},
		async showGrid(input) {
			const panel = { id: id('panel'), kind: 'grid' as const, instanceSetId: input.instanceSetId };
			ws.panels.push(panel);
			return panel;
		},
		async focusInstance() {},
		async getWorkspace() {
			return ws;
		}
	};
}

async function availableNames(engine: ResearchEngine): Promise<string[]> {
	const ws = await engine.getWorkspace();
	return buildTools(engine)
		.filter((t) => t.available(ws))
		.map((t) => t.name);
}

describe('tool availability', () => {
	it('exposes only the base tools before any instance set exists', async () => {
		const engine = fakeEngine();
		expect(await availableNames(engine)).toEqual([
			'defineStudy',
			'defineSetup',
			'findInstances',
			'getWorkspace'
		]);
	});

	it('unlocks analysis tools once findInstances produces a set', async () => {
		const engine = fakeEngine();
		const setup = await engine.defineSetup({ steps: [{ condition: 'gap_pct > 4' }] });
		await engine.findInstances({ setupId: setup.id });
		const names = await availableNames(engine);
		expect(names).toContain('measure');
		expect(names).toContain('splitInstances');
		expect(names).toContain('showGrid');
		expect(names).toContain('sampleInstances');
		expect(names).not.toContain('focusInstance');
	});

	it('unlocks focusInstance once a panel exists', async () => {
		const engine = fakeEngine();
		const setup = await engine.defineSetup({ steps: [{ condition: 'gap_pct > 4' }] });
		const set = await engine.findInstances({ setupId: setup.id });
		await engine.showGrid({ instanceSetId: set.id });
		expect(await availableNames(engine)).toContain('focusInstance');
	});
});

describe('tool execution', () => {
	it('returns the function catalog on an expression error instead of throwing', async () => {
		const engine = fakeEngine();
		const defineStudy = buildTools(engine).find((t) => t.name === 'defineStudy');
		expect(defineStudy).toBeDefined();
		const result = await defineStudy!.execute({ name: 'bad', expression: 'zscore(close, 20)' });
		expect(result.isError).toBe(true);
		const payload = JSON.parse(result.content[0]!.text);
		expect(payload.availableFunctions).toEqual(CATALOG);
	});

	it('returns engine results as JSON text content', async () => {
		const engine = fakeEngine();
		const defineStudy = buildTools(engine).find((t) => t.name === 'defineStudy');
		const result = await defineStudy!.execute({
			name: 'rel_volume_20',
			expression: 'volume / sma(volume, 20)'
		});
		expect(result.isError).toBeUndefined();
		const payload = JSON.parse(result.content[0]!.text);
		expect(payload.id).toBe('study_1');
		expect(payload.name).toBe('rel_volume_20');
	});
});
