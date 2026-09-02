// The T-1014-2 authoring surface assembled: create_computed_field and
// create_custom_study, plus the two operations they register. Mirrors
// alerts/tools/index.ts's shape.
import type { CatalogRegistry } from '../../../catalog/registry';
import type { ToolSpec } from '../../../webmcp/types';
import type { IdSequencer } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import {
	CREATE_COMPUTED_FIELD_KIND,
	ensureCreateComputedFieldOperation
} from '../application/createComputedField';
import {
	CREATE_CUSTOM_STUDY_KIND,
	ensureCreateCustomStudyOperation
} from '../application/createCustomStudy';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import { buildCreateComputedFieldTool } from './createComputedField';
import { buildCreateCustomStudyTool } from './createCustomStudy';

export interface FollowupAuthoringToolsDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
	// Absent means the built-in catalog composed with the target workspace's
	// own computed fields/custom studies, matching every other tool group's
	// "override registry, default built-in" convention -- see
	// registerFollowupTools.ts for where that default is actually built.
	catalog?: CatalogRegistry;
}

export const FOLLOWUP_OPERATION_KINDS: readonly string[] = [
	CREATE_COMPUTED_FIELD_KIND,
	CREATE_CUSTOM_STUDY_KIND
];

export function registerFollowupOperations(deps: FollowupAuthoringToolsDeps): void {
	ensureCreateComputedFieldOperation(deps.registry, { clock: deps.clock });
	ensureCreateCustomStudyOperation(deps.registry, { clock: deps.clock });
}

export function buildFollowupAuthoringTools(deps: FollowupAuthoringToolsDeps): ToolSpec[] {
	registerFollowupOperations(deps);
	const catalogOpt = deps.catalog !== undefined ? { catalog: deps.catalog } : {};
	return [
		buildCreateComputedFieldTool({
			repository: deps.repository,
			revisions: deps.revisions,
			history: deps.history,
			registry: deps.registry,
			clock: deps.clock,
			ids: deps.ids,
			...catalogOpt
		}),
		buildCreateCustomStudyTool({
			repository: deps.repository,
			revisions: deps.revisions,
			history: deps.history,
			registry: deps.registry,
			clock: deps.clock,
			ids: deps.ids,
			...catalogOpt
		})
	];
}
