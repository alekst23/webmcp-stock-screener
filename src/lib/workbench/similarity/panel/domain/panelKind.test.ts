import { describe, expect, it } from 'vitest';
import { createPanelRegistry } from '../../../../panels/registry/panelKindRegistry';
import { similarOpportunitiesPanelKindDefinition } from './panelKind';

describe('similarOpportunitiesPanelKindDefinition', () => {
	// A fresh registry, not the shared module-global default: EPIC-1007's
	// defaultPanelKinds.ts already occupies this kind name there with a
	// placeholder, and PanelRegistry.register() throws on a duplicate --
	// see this ticket's Solution Approach.
	it('registers into a fresh panel registry with no special-casing', () => {
		const registry = createPanelRegistry();
		expect(() => registry.register(similarOpportunitiesPanelKindDefinition)).not.toThrow();
		expect(registry.has('similar_opportunities')).toBe(true);
		expect(registry.require('similar_opportunities')).toBe(similarOpportunitiesPanelKindDefinition);
	});

	it('matches the design doc link-channel matrix for this kind', () => {
		expect(similarOpportunitiesPanelKindDefinition.linkChannels).toEqual([
			'symbol',
			'timeframe',
			'result_selection'
		]);
	});

	it('is not source-bound: it is bound to a similarity run through config, not the source/renderer contract', () => {
		expect(similarOpportunitiesPanelKindDefinition.bindingTypes).toEqual([]);
		expect(similarOpportunitiesPanelKindDefinition.defaultRenderer).toBeNull();
	});

	it('defaults to no run bound', () => {
		expect(similarOpportunitiesPanelKindDefinition.defaultConfig()).toEqual({ runId: null });
	});

	describe('validateConfig', () => {
		it('accepts a config with a run id', () => {
			const result = similarOpportunitiesPanelKindDefinition.validateConfig({ runId: 'run_1' });
			expect(result.ok).toBe(true);
		});

		it('accepts a config with a null run id', () => {
			const result = similarOpportunitiesPanelKindDefinition.validateConfig({ runId: null });
			expect(result.ok).toBe(true);
		});

		it('rejects a non-string, non-null run id', () => {
			const result = similarOpportunitiesPanelKindDefinition.validateConfig({ runId: 42 });
			expect(result.ok).toBe(false);
		});

		it('rejects an unrecognized field', () => {
			const result = similarOpportunitiesPanelKindDefinition.validateConfig({
				runId: 'run_1',
				selectedCandidateId: 'x'
			});
			expect(result.ok, 'candidate selection belongs to state.selections, not this config').toBe(
				false
			);
		});

		it('rejects a non-object input', () => {
			expect(similarOpportunitiesPanelKindDefinition.validateConfig('not an object').ok).toBe(
				false
			);
		});
	});

	it('resolves its component loader without throwing', async () => {
		const loaded = await similarOpportunitiesPanelKindDefinition.component();
		expect(
			loaded,
			'expected the lazy-loaded component module to resolve to something'
		).toBeTruthy();
	});
});
