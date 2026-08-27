import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { buildTools } from '../webmcp/tools';
import { createDevEngine } from './devEngine';
import { createWorkspaceStore } from './store';

// In-memory Storage so each test gets an isolated backing store instead of
// depending on (and leaking state through) jsdom's shared global localStorage.
function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key) => (data.has(key) ? (data.get(key) ?? null) : null),
		setItem: (key, value) => void data.set(key, String(value)),
		removeItem: (key) => void data.delete(key),
		clear: () => data.clear(),
		key: (index) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	};
}

describe('workspace state visibility', () => {
	it('reflects defined studies, setups, result sets, panels, and focus/selection in one readable view', async () => {
		const store = createWorkspaceStore(memoryStorage());
		const engine = createDevEngine(store);

		const study = await engine.defineStudy({
			name: 'rel_vol_20',
			expression: 'volume / sma(volume, 20)'
		});
		const setup = await engine.defineSetup({ steps: [{ condition: 'gap_pct > 4' }] });
		const set = await engine.findInstances({ setupId: setup.id });
		const panel = await engine.showGrid({ instanceSetId: set.id });
		await engine.focusInstance({ ticker: 'ACME', date: '2024-03-08', panelId: panel.id });

		const ws = get(store);
		expect(
			ws.studies.map((s) => s.id),
			`studies: ${JSON.stringify(ws.studies)}`
		).toContain(study.id);
		expect(
			ws.setups.map((s) => s.id),
			`setups: ${JSON.stringify(ws.setups)}`
		).toContain(setup.id);
		expect(
			ws.instanceSets.map((s) => s.id),
			`instanceSets: ${JSON.stringify(ws.instanceSets)}`
		).toContain(set.id);
		expect(
			ws.panels.map((p) => p.id),
			`panels: ${JSON.stringify(ws.panels)}`
		).toContain(panel.id);
		expect(ws.focus?.panelId, `focus: ${JSON.stringify(ws.focus)}`).toBe(panel.id);
	});
});

describe('workspace persistence', () => {
	it('restores workspace state after a simulated page reload in the same browser', async () => {
		const storage = memoryStorage();
		const storeBeforeReload = createWorkspaceStore(storage);
		const engine = createDevEngine(storeBeforeReload);

		const setup = await engine.defineSetup({ steps: [{ condition: 'gap_pct > 4' }] });
		await engine.findInstances({ setupId: setup.id });

		// A page reload discards the in-memory store but not the localStorage
		// backing it — constructing a fresh store against the same Storage
		// simulates that reload.
		const storeAfterReload = createWorkspaceStore(storage);
		const restored = get(storeAfterReload);

		expect(
			restored.setups.map((s) => s.id),
			`restored setups: ${JSON.stringify(restored.setups)}`
		).toContain(setup.id);
		expect(restored.instanceSets, `restored instanceSets`).toHaveLength(1);
	});
});

describe('dev control surface', () => {
	it('lets a manual tool invocation update the same state view an agent would read', async () => {
		const store = createWorkspaceStore(memoryStorage());
		const engine = createDevEngine(store);
		const defineStudy = buildTools(engine).find((t) => t.name === 'defineStudy');
		expect(defineStudy, 'defineStudy tool should be registered').toBeDefined();

		const result = await defineStudy!.execute({
			name: 'rel_vol_20',
			expression: 'sma(close, 10)'
		});
		expect(result.isError, `execute() failed: ${JSON.stringify(result)}`).toBeUndefined();

		// The manual invocation went through buildTools()'s execute(), exactly
		// as an agent-driven call would — getWorkspace() and the raw store both
		// see the same resulting state.
		const ws = await engine.getWorkspace();
		expect(ws.studies, `via getWorkspace(): ${JSON.stringify(ws.studies)}`).toHaveLength(1);
		expect(get(store).studies, `via raw store: ${JSON.stringify(get(store).studies)}`).toHaveLength(
			1
		);
	});
});
