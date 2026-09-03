import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { setPanelRenderer } from './setPanelRenderer';
import { bindPanelSource } from './bindPanelSource';

function ctx() {
	return { actor: 'agent' as const };
}

describe('bindPanelSource', () => {
	it('AC4: rebinds to a compatible source, leaving the renderer unchanged', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' }); // chart_grid renderer by default

		const envelope = bindPanelSource(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			source: { type: 'screener_results', ref: { run_id: 'run_1' } }
		});
		expect(envelope.affectedIds).toEqual(['panel_chart_1']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const panel = state.panels[0]!;
		expect(panel.source).toEqual({ type: 'screener_results', ref: { run_id: 'run_1' } });
		expect(panel.renderer, 'binding a source must not change the renderer').toBe('chart_grid');
	});

	it('AC4: an incompatible source type is rejected, the panel unchanged, and accepted types listed', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });
		setPanelRenderer(deps, { context: ctx(), panelId: 'panel_chart_1', renderer: 'scatter_plot' });

		try {
			bindPanelSource(deps, {
				context: ctx(),
				panelId: 'panel_chart_1',
				source: { type: 'watchlist', ref: { watchlist_id: 'w1' } }
			});
			expect.fail('expected an invalid_source error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			const opErr = err as PanelOperationError;
			expect(opErr.code).toBe('invalid_source');
			expect((opErr.details.acceptedSourceTypes as string[]).sort()).toEqual([
				'screener_results',
				'symbol_list'
			]);
		}
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(
			state.panels[0]!.source,
			'the panel must remain unbound after a rejected bind'
		).toBeNull();
	});

	// Bug fix (see git history): a source type's binding can have a real
	// effect beyond panel.source itself (the chart source type is the
	// motivating case -- its ref carries state that lives in the chart
	// extension, not panel.source). SourceTypeDefinition.applyBinding
	// (sourceRendererRegistry.ts) is the generic hook for that; this proves
	// bindPanelSource folds it into the same commit, using a fake source
	// type rather than chart's real one so this stays a test of the generic
	// wiring, not of chart's own logic (see chartPanelKind.test.ts for that).
	it("bug fix: a source type's applyBinding hook is folded into the same commit as the panel-source write", () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });

		deps.sourceRenderer.registerSourceType({
			name: 'test_source_with_effect',
			refSchema: { type: 'object' },
			validateRef: (ref) => ({ ok: true, value: ref as Record<string, unknown> }),
			isCompatible: () => true,
			compatibilityDescription: 'test only',
			applyBinding: (doc, panelId, ref) => ({
				...doc,
				extensions: { ...doc.extensions, test_marker: { panelId, ref } }
			})
		});

		const envelope = bindPanelSource(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			source: { type: 'test_source_with_effect', ref: { foo: 'bar' } }
		});
		expect(envelope.affectedIds).toEqual(['panel_chart_1']);

		const doc = deps.repository.get(deps.workspaceId)!;
		expect(
			doc.extensions.test_marker,
			"expected applyBinding's document effect to have landed in the same commit"
		).toEqual({ panelId: 'panel_chart_1', ref: { foo: 'bar' } });
		const state = readPanelState(doc);
		expect(
			state.panels[0]!.source,
			'applyBinding must not replace the normal panel.source write, only add to it'
		).toEqual({ type: 'test_source_with_effect', ref: { foo: 'bar' } });
	});

	it('a source type with no applyBinding hook leaves the document otherwise untouched (backward compatible)', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });

		bindPanelSource(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			source: { type: 'screener_results', ref: { run_id: 'run_1' } }
		});

		const doc = deps.repository.get(deps.workspaceId)!;
		expect(Object.keys(doc.extensions).sort()).toEqual(['panel_system']);
	});

	it('AC4: an unknown panel id fails and says the id is unknown', () => {
		const deps = createPanelTestHarness();
		try {
			bindPanelSource(deps, {
				context: ctx(),
				panelId: 'panel_chart_99',
				source: { type: 'screener_results', ref: { run_id: 'r' } }
			});
			expect.fail('expected an unknown_panel error');
		} catch (err) {
			expect((err as PanelOperationError).code).toBe('unknown_panel');
		}
	});
});
