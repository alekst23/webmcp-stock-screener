// hotfix/panel-system: replaces whatever panel arrangement currently exists
// with the canonical default seed (domain/defaultLayout.ts's
// DEFAULT_SEED_PANELS) -- the same six panels seedDefaultWorkspace creates
// for a brand-new workspace, minted fresh here rather than reusing the
// existing panels' ids, since the current arrangement may have a different
// panel count or kinds than the seed. One commitPanelChange call, so the
// whole replacement is one revision with one undo token (spec.md: "as one
// revisioned change"). Links and selections reference panel ids that no
// longer exist after a reset, so both reset to empty rather than being
// carried over.
//
// CONTRACT STUB -- signature only; see docs/design/panel-system/technical.md
// for the intended implementation. Body replaced by the implementing agent,
// driven by resetLayout.test.ts.
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { commitPanelChange, type PanelUseCaseDeps } from './support';

export interface ResetLayoutRequest {
	context: MutationContext;
}

export function resetLayout(deps: PanelUseCaseDeps, request: ResetLayoutRequest): MutationEnvelope {
	return commitPanelChange(deps, request.context, 'panels.reset_layout', request, () => {
		throw new Error('resetLayout: not implemented');
	});
}
