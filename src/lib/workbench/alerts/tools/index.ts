// The alert surface assembled: three tools (T-1014-8's create_alert_draft,
// edit_alert_draft, preview_alert) and the two operations the mutating pair
// register. T-1014-9 adds enable_alert/disable_alert here alongside these,
// not in place of them.
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
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import type { AlertHistoricalDataPort } from '../domain/alertPreview';
import { buildCreateAlertDraftTool } from './createAlertDraft';
import { buildEditAlertDraftTool } from './editAlertDraft';
import { buildPreviewAlertTool } from './previewAlert';

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

// The two kinds this ticket's tools go through. Named as a list, mirroring
// chart's CHART_OPERATION_KINDS, so T-1014-9's author can assert the surface
// they are extending without knowing where each kind is defined.
export const ALERT_OPERATION_KINDS: readonly string[] = [
	ALERTS_CREATE_DRAFT_KIND,
	ALERTS_EDIT_CONDITIONS_KIND
];

export function registerAlertOperations(deps: AlertToolsDeps): void {
	ensureCreateAlertDraftOperation(deps.registry, { clock: deps.clock });
	ensureEditAlertDraftOperation(deps.registry, { clock: deps.clock });
}

export function buildAlertTools(deps: AlertToolsDeps): ToolSpec[] {
	registerAlertOperations(deps);
	const catalogOpt = deps.catalog !== undefined ? { catalog: deps.catalog } : {};
	return [
		buildCreateAlertDraftTool({
			repository: deps.repository,
			revisions: deps.revisions,
			history: deps.history,
			registry: deps.registry,
			clock: deps.clock,
			ids: deps.ids,
			...catalogOpt
		}),
		buildEditAlertDraftTool({
			repository: deps.repository,
			revisions: deps.revisions,
			history: deps.history,
			registry: deps.registry,
			clock: deps.clock,
			ids: deps.ids,
			...catalogOpt
		}),
		buildPreviewAlertTool({
			repository: deps.repository,
			port: deps.historicalData,
			clock: deps.clock
		})
	];
}
