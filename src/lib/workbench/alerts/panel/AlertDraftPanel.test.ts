// T-1015-12: component tests for the real alert_draft panel body. Mirrors
// watchlist/panel/WatchlistPanel.test.ts's own mount/unmount shape and
// results/panel/ResultsTablePanel.test.ts's "explicit empty state, never a
// fabricated list" convention.
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { emptyWorkspace } from '../../domain/workspace';
import type { PanelUseCaseDeps } from '../../../panels/application';
import type { Panel } from '../../../panels/domain/panel';
import { makePanel } from '../../../panels/domain/panel';
import { writeAlert, type AlertRecord } from '../domain/alert';
import AlertDraftPanel from './AlertDraftPanel.svelte';

const WORKSPACE_ID = 'workspace_1';

function harness(): {
	deps: PanelUseCaseDeps;
	repository: ReturnType<typeof createLocalWorkspaceRepository>;
} {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	repository.put(emptyWorkspace(WORKSPACE_ID, 'Test', '2026-01-01T00:00:00.000Z'));
	const deps = {
		workspaceId: WORKSPACE_ID,
		repository
	} as unknown as PanelUseCaseDeps;
	return { deps, repository };
}

function makeAlertDraftPanel(): Panel {
	return makePanel({
		id: 'panel_1',
		kind: 'alert_draft',
		title: 'Alert Draft',
		config: {},
		rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
	});
}

function draftAlert(input: Partial<AlertRecord> = {}): AlertRecord {
	return {
		alertId: 'alert_1',
		workspaceId: WORKSPACE_ID,
		name: 'Breakout above 50',
		state: 'draft',
		source: { kind: 'conditions', conditions: [] },
		previewable: true,
		previewProblems: [],
		pendingActivation: null,
		activationHistory: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...input
	};
}

interface Mounted {
	target: HTMLElement;
	instance: object;
}

function mountPanel(panel: Panel, deps: PanelUseCaseDeps): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(AlertDraftPanel, {
		target,
		props: { panel, onBroadcast: () => false, deps: { useCaseDeps: deps } }
	});
	flushSync();
	return { target, instance };
}

describe('AlertDraftPanel', () => {
	it('renders an explicit empty state when there are no draft alerts', () => {
		const { deps } = harness();
		const { target, instance } = mountPanel(makeAlertDraftPanel(), deps);
		expect(target.textContent).toContain('No alert drafts are pending review');
		unmount(instance);
	});

	it('renders a drafted alert pending review', () => {
		const { deps, repository } = harness();
		repository.put(writeAlert(repository.get(WORKSPACE_ID)!, draftAlert()));

		const { target, instance } = mountPanel(makeAlertDraftPanel(), deps);
		expect(target.textContent).toContain('Breakout above 50');
		expect(target.textContent).toContain('previewable');
		unmount(instance);
	});

	it('excludes an alert that is no longer in the draft state', () => {
		const { deps, repository } = harness();
		repository.put(
			writeAlert(repository.get(WORKSPACE_ID)!, draftAlert({ state: 'armed', name: 'Armed Alert' }))
		);

		const { target, instance } = mountPanel(makeAlertDraftPanel(), deps);
		expect(target.textContent).not.toContain('Armed Alert');
		expect(target.textContent).toContain('No alert drafts are pending review');
		unmount(instance);
	});
});
