// T-1015-10: failing test stubs for restoring the panel-close and
// action-log UI affordances. Per project convention there is no Svelte
// component-render harness (see T-1015-3's Solution Approach), so
// PanelFrame/shell wiring stubs describe the expected wiring rather than
// mounting components; panelController.ts's new helper functions
// (removePanelByHuman, readActionLog) are pure logic and get real unit
// coverage once implemented.
//
// Note (T-1015-10's Solution Approach): AC2's `actor` field already
// exists on ChangeRecord/get_change_history and is already populated by
// several existing human-triggered call sites -- the stub below still
// throws per this file's uniform "not yet implemented" convention, but
// the real assertion it drives toward may turn out to already hold and
// only need a confirming test, not new production code.
//
// Each stub currently throws to fail clearly; the real assertions land
// when T-1015-10 is implemented.

import { describe, it } from 'vitest';

describe('a human can close a panel by hand', () => {
	// spec.md "Route migration / Panel close"; T-1015-10 AC1
	it('PanelFrame exposes a human-clickable close control alongside the collapse control', () => {
		throw new Error(
			'not implemented: T-1015-10 AC1 -- PanelFrame.svelte gains an onRemove prop and a ' +
				'close button in .panel-header, wired the same way onToggleCollapse already is'
		);
	});

	it('clicking the close control has the same effect as the agent-side remove-panel action', () => {
		throw new Error(
			'not implemented: T-1015-10 AC1 -- removePanelByHuman(deps, panelId) calls the same ' +
				'panels/application/removePanel.ts removePanel() an agent tool call would, with ' +
				"context: { actor: 'human' }"
		);
	});
});

describe('action-log entries carry human-vs-agent attribution', () => {
	// spec.md "Route migration / Action log access"; T-1015-10 AC2
	it("every new ChangeRecord has an actor: 'human' | 'agent' field populated", () => {
		throw new Error(
			"not implemented: T-1015-10 AC2 -- confirm ChangeRecord.actor (workbench/domain/" +
				'mutation.ts, workbench/application/changeHistory.ts) is populated for every ' +
				'recordCommit call site, including the new panel-close button'
		);
	});
});

describe('the shell exposes an expandable action log', () => {
	// spec.md "Route migration / Action log access"; T-1015-10 AC3
	it("a compact header icon expands into a log listing every recorded action with its actor", () => {
		throw new Error(
			'not implemented: T-1015-10 AC3 -- the shell (T-1015-9) gets an icon that toggles a ' +
				'new ActionLogPanel.svelte, populated via a new readActionLog(deps, limit) helper ' +
				'that calls ChangeHistory.list directly'
		);
	});

	it('is not an always-visible section, unlike the legacy page\'s log', () => {
		throw new Error(
			'not implemented: T-1015-10 AC3 -- the log starts collapsed; it is user direction, per ' +
				"the ticket description, that this is scoped down from the legacy page's " +
				'always-visible ActivityFeed'
		);
	});
});

describe('closing a panel a human did not create works the same way', () => {
	// T-1015-10 AC4
	it('removing an agent-created panel via the close control succeeds identically', () => {
		throw new Error(
			'not implemented: T-1015-10 AC4 -- removePanel does not check who created the panel; ' +
				'create a panel with actor: "agent" then close it with actor: "human" and confirm ' +
				'it is removed'
		);
	});
});

describe('production build succeeds and both affordances work with no console errors', () => {
	// T-1015-10 AC5
	it('panel close and the action-log icon both work in a real browser', () => {
		throw new Error(
			'not implemented: T-1015-10 AC5 -- verified via browser check at ticket close per ' +
				'project convention, not a vitest assertion; this stub tracks that the check happens'
		);
	});
});
