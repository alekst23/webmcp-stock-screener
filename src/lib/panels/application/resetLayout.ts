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
// spec.md's "Already at default" scenario: if the current panels already
// match the default seed by kind+rect (order-independent), this is a no-op
// -- the call still succeeds and writes a new revision (commitPanelChange
// always writes), but nothing is effectively changed: no new panel ids are
// minted, and links/selections are left untouched rather than reset, since
// nothing was actually invalidated. Same idiom as linkPanels.ts's own
// "already linked; no change" case.
import { PanelOperationError } from './errors';
import { DEFAULT_SEED_PANELS } from '../domain/defaultLayout';
import { emptyLinkGraph } from '../domain/links';
import { makePanel, type Panel } from '../domain/panel';
import type { GridRect } from '../domain/grid';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import {
	commitPanelChange,
	requireKnownRenderer,
	requirePanelKind,
	type PanelUseCaseDeps
} from './support';

export interface ResetLayoutRequest {
	context: MutationContext;
}

function sameRect(a: GridRect, b: GridRect): boolean {
	return a.col === b.col && a.row === b.row && a.colSpan === b.colSpan && a.rowSpan === b.rowSpan;
}

// Order-independent: sorts both sides by kind before comparing, since panel
// creation/insertion order carries no meaning here -- only the resulting
// kind+rect arrangement does.
function matchesDefaultSeed(panels: Panel[]): boolean {
	if (panels.length !== DEFAULT_SEED_PANELS.length) {
		return false;
	}
	const current = [...panels].sort((a, b) => a.kind.localeCompare(b.kind));
	const seed = [...DEFAULT_SEED_PANELS].sort((a, b) => a.kind.localeCompare(b.kind));
	return current.every((panel, i) => {
		const spec = seed[i]!;
		return panel.kind === spec.kind && sameRect(panel.rect, spec.rect);
	});
}

export function resetLayout(deps: PanelUseCaseDeps, request: ResetLayoutRequest): MutationEnvelope {
	return commitPanelChange(deps, request.context, 'panels.reset_layout', request, (_doc, state) => {
		if (matchesDefaultSeed(state.panels)) {
			return {
				nextState: state,
				affectedIds: [],
				diffSummary: 'Workspace layout already matches the default arrangement; no change.'
			};
		}

		const panels: Panel[] = DEFAULT_SEED_PANELS.map((spec) => {
			const kindDef = requirePanelKind(deps.kinds, spec.kind);
			const renderer = kindDef.defaultRenderer;
			if (renderer !== null) {
				requireKnownRenderer(deps.sourceRenderer, renderer);
			}
			const config = kindDef.defaultConfig();
			const configValidation = kindDef.validateConfig(config);
			if (!configValidation.ok) {
				throw new PanelOperationError(
					'invalid_config',
					`Configuration rejected for panel kind "${spec.kind}".`,
					{ errors: configValidation.errors }
				);
			}
			const id = deps.ids.next('panel', spec.kind);
			return makePanel({
				id,
				kind: spec.kind,
				title: kindDef.defaultTitle,
				config: configValidation.value,
				rect: spec.rect,
				renderer
			});
		});

		return {
			nextState: { ...state, panels, links: emptyLinkGraph(), selections: {} },
			affectedIds: panels.map((p) => p.id),
			diffSummary: 'Reset workspace layout to the default arrangement.'
		};
	});
}
