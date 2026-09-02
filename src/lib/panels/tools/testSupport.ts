// Test-only glue: PanelToolDeps built from the wave-1 test harness plus a
// fresh MaximizedPanelHandle, so every test gets its own maximize state
// rather than sharing one across tests.
import { createPanelTestHarness, type PanelTestHarness } from '../application/testSupport';
import { createMaximizedPanelState } from './maximizedState';
import type { PanelToolDeps } from './panelTools';

export interface PanelToolTestHarness extends PanelTestHarness, PanelToolDeps {}

export function createPanelToolTestHarness(workspaceId = 'workspace_1'): PanelToolTestHarness {
	const harness = createPanelTestHarness(workspaceId);
	return { ...harness, maximized: createMaximizedPanelState() };
}

// Every tool result's payload is JSON text in content[0].text -- this is
// the one place that's parsed back out, so tests assert on structured
// data rather than substrings.
export function resultPayload(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}
