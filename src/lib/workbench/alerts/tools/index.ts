// The alert surface assembled: T-1014-8's create_alert_draft,
// edit_alert_draft and preview_alert, plus T-1014-9's enable_alert and
// disable_alert -- five tools, four operations. Note what is NOT here:
// there is no sixth tool for confirming or declining an activation. That
// transition (application/confirmAlertActivation.ts /
// declineAlertActivation.ts) is deliberately never built into a ToolSpec at
// all, in this file or anywhere else -- it is reachable only from the
// app's own alerts-surface UI code.
import type { CatalogRegistry } from '../../../catalog/registry';
import type { ToolSpec } from '../../../webmcp/types';
import type { IdSequencer } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import {
	ensureCreateAlertDraftOperation,
	ALERTS_CREATE_DRAFT_KIND
} from '../application/createAlertDraft';
import {
	ensureEditAlertDraftOperation,
	ALERTS_EDIT_CONDITIONS_KIND
} from '../application/editAlertDraft';
import {
	ensureEnableAlertOperation,
	ALERTS_ENABLE_ACTIVATION_KIND
} from '../application/enableAlert';
import {
	ensureDisableAlertOperation,
	ALERTS_DISABLE_ACTIVATION_KIND
} from '../application/disableAlert';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import type { AlertHistoricalDataPort } from '../domain/alertPreview';
import { buildCreateAlertDraftTool } from './createAlertDraft';
import { buildEditAlertDraftTool } from './editAlertDraft';
import { buildPreviewAlertTool } from './previewAlert';
import { buildEnableAlertTool } from './enableAlert';
import { buildDisableAlertTool } from './disableAlert';

export interface AlertToolsDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
	historicalData: AlertHistoricalDataPort;
	// Absent means the built-in catalog, matching the chart/screener tools'
	// own convention.
	catalog?: CatalogRegistry;
}

// The four operation kinds this surface's mutating tools go through --
// create/edit (T-1014-8) and enable/disable (T-1014-9). Named as a list,
// mirroring chart's CHART_OPERATION_KINDS. Deliberately absent: any kind for
// confirming or declining an activation -- that transition has no
// OperationDefinition and is not registered in the shared OperationRegistry
// at all (see application/confirmAlertActivation.ts).
export const ALERT_OPERATION_KINDS: readonly string[] = [
	ALERTS_CREATE_DRAFT_KIND,
	ALERTS_EDIT_CONDITIONS_KIND,
	ALERTS_ENABLE_ACTIVATION_KIND,
	ALERTS_DISABLE_ACTIVATION_KIND
];

export function registerAlertOperations(deps: AlertToolsDeps): void {
	ensureCreateAlertDraftOperation(deps.registry, { clock: deps.clock });
	ensureEditAlertDraftOperation(deps.registry, { clock: deps.clock });
	ensureEnableAlertOperation(deps.registry, { clock: deps.clock });
	ensureDisableAlertOperation(deps.registry, { clock: deps.clock });
}

export function buildAlertTools(deps: AlertToolsDeps): ToolSpec[] {
	registerAlertOperations(deps);
	const catalogOpt = deps.catalog !== undefined ? { catalog: deps.catalog } : {};
	const commonDeps = {
		repository: deps.repository,
		revisions: deps.revisions,
		history: deps.history,
		registry: deps.registry,
		clock: deps.clock,
		ids: deps.ids
	};
	return [
		buildCreateAlertDraftTool({ ...commonDeps, ...catalogOpt }),
		buildEditAlertDraftTool({ ...commonDeps, ...catalogOpt }),
		buildPreviewAlertTool({
			repository: deps.repository,
			port: deps.historicalData,
			clock: deps.clock
		}),
		// T-1014-9: the review-gated pair. enable_alert can only ever create a
		// pending activation request; disable_alert needs no confirmation. The
		// transition to 'armed' itself is implemented in
		// application/confirmAlertActivation.ts, which is never built into a
		// ToolSpec here or anywhere else in this surface.
		buildEnableAlertTool(commonDeps),
		buildDisableAlertTool(commonDeps)
	];
}
