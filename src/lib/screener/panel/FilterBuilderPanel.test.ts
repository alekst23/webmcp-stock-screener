// T-0027-1: end-to-end component tests for the real filter_builder panel
// body. Mirrors results/panel/ResultsTablePanel.test.ts's own harness
// pattern (mount/unmount/flushSync, `deps` passed as an explicit prop
// override rather than relying on the module-scoped runtime-deps
// singleton).
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import { emptyWorkspace } from '../../workbench/domain/workspace';
import { createLayoutTemplateRegistry } from '../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import type { PanelUseCaseDeps } from '../../panels/application';
import { createScreener } from '../definition';
import { writeScreener } from '../state';
import { resetFilterBuilderPanelRuntimeDeps } from './filterBuilderPanelContext';
import FilterBuilderPanel from './FilterBuilderPanel.svelte';

const WORKSPACE_ID = 'workspace_1';

function harness(): PanelUseCaseDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => '2026-01-01T00:00:00.000Z' };
	const ids = createIdSequencer();
	repository.put(emptyWorkspace(WORKSPACE_ID, 'Workbench', clock.now()));
	return {
		workspaceId: WORKSPACE_ID,
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		clock,
		ids,
		kinds: createPanelRegistry(),
		sourceRenderer: createSourceRendererRegistry(),
		templates: createLayoutTemplateRegistry()
	};
}

// Sets the workspace's current screener directly on the fixture document --
// per the epic's own note, this ticket is buildable and testable against a
// fixture WorkspaceDocument independently of EPIC-0026's define_screener
// tool landing; only the shape (screenerId pointing at an entry in
// extensions.screener) matters here, not how it got there.
function seedCurrentScreener(deps: PanelUseCaseDeps): string {
	const doc = deps.repository.get(deps.workspaceId)!;
	const screener = createScreener(deps.ids, deps.workspaceId, 'My Screener');
	screener.universe.assetClass = 'equity';
	screener.universe.exchanges = ['XNAS'];
	const withScreener = writeScreener(doc, screener);
	deps.repository.put({ ...withScreener, screenerId: screener.screenerId });
	return screener.screenerId;
}

function samplePanel() {
	return {
		id: 'panel_1',
		kind: 'filter_builder',
		title: 'Filter Builder',
		config: { filterTree: {} },
		rect: { col: 0, row: 0, colSpan: 2, rowSpan: 4 },
		hidden: false,
		collapsed: false,
		source: null,
		renderer: null
	};
}

interface Mounted {
	target: HTMLElement;
	instance: object;
}

function mountPanel(deps: PanelUseCaseDeps): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(FilterBuilderPanel, {
		target,
		props: {
			panel: samplePanel(),
			onBroadcast: () => false,
			deps: { useCaseDeps: deps }
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	resetFilterBuilderPanelRuntimeDeps();
});

describe('FilterBuilderPanel', () => {
	it('AC1: shows an explicit empty state when there is no current screener', () => {
		const { target, instance } = mountPanel(harness());
		expect(target.textContent).toContain('No screener yet.');
		unmount(instance);
	});

	it('AC2: renders universe, filter tree, and ranking once a screener exists', () => {
		const deps = harness();
		seedCurrentScreener(deps);
		const { target, instance } = mountPanel(deps);
		expect(target.textContent).toContain('Asset class: equity');
		expect(target.textContent).toContain('Exchanges: XNAS');
		expect(target.textContent, 'the empty root group renders as an explicit AND (empty)').toContain(
			'AND (empty)'
		);
		expect(target.textContent).toContain('Default order (no ranking configured).');
		unmount(instance);
	});

	it('AC3: a fresh mount after the screener changes reflects the new definition', () => {
		const deps = harness();
		seedCurrentScreener(deps);
		const first = mountPanel(deps);
		expect(first.target.textContent).toContain('Asset class: equity');
		unmount(first.instance);

		const doc = deps.repository.get(deps.workspaceId)!;
		const screener = createScreener(deps.ids, deps.workspaceId, 'Redefined');
		screener.universe.assetClass = 'etf';
		const withScreener = writeScreener(doc, screener);
		deps.repository.put({ ...withScreener, screenerId: screener.screenerId });

		const second = mountPanel(deps);
		expect(second.target.textContent).toContain('Asset class: etf');
		expect(second.target.textContent).not.toContain('Asset class: equity');
		unmount(second.instance);
	});

	it('AC4: exposes no controls that mutate the screener', () => {
		const deps = harness();
		seedCurrentScreener(deps);
		const { target, instance } = mountPanel(deps);
		expect(target.querySelectorAll('button, input, select, textarea').length).toBe(0);
		unmount(instance);
	});
});
