// Turns an AlertConditionSource into the throwaway ScreenerDefinition shape
// EPIC-1009's `validateScreenerDefinition` already understands (T-1014-8,
// AC8). No contradiction or unavailable-data detection is reimplemented here
// -- this module's only job is building the input, exactly as the design
// references direct: the not-previewable check "parallels validate_screener's
// contradictory-filter and unavailable-data detection."
//
// Domain layer: pure construction, no I/O.
import type { ScreenerDefinition } from '../../../screener/definition';
import { emptyUniverse } from '../../../screener/definition';
import type { AlertConditionSource } from './alert';

// A stable, obviously-synthetic id: this definition is never stored and never
// addressed by anything outside one validation call.
const SYNTHETIC_SCREENER_ID = 'alert_conditions_preview';
const SYNTHETIC_ROOT_NODE_ID = 'alert_root';

export function toEvaluableDefinition(
	source: AlertConditionSource,
	workspaceId: string
): ScreenerDefinition {
	if (source.kind === 'screener_revision') {
		return {
			screenerId: source.screenerId,
			workspaceId,
			name: null,
			revision: source.screenerRevision,
			universe: source.universe,
			filterTree: source.filterTree,
			ranking: null
		};
	}
	return {
		screenerId: SYNTHETIC_SCREENER_ID,
		workspaceId,
		name: null,
		revision: 1,
		universe: emptyUniverse(),
		filterTree: {
			nodeId: SYNTHETIC_ROOT_NODE_ID,
			kind: 'group',
			op: 'and',
			enabled: true,
			children: source.conditions.map((condition, index) => ({
				nodeId: `alert_cond_${index}`,
				kind: 'condition' as const,
				condition,
				enabled: true
			}))
		},
		ranking: null
	};
}
