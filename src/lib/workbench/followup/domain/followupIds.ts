// Stable, catalog-shaped IDs for computed fields and custom studies
// (T-1014-2). A created field/study is addressed everywhere a built-in
// `field.*`/`study.*` catalog ID already is (FieldRefNode.fieldId,
// Condition.fieldId/studyId, RankingField.fieldId, ColumnIdentity.fieldId) --
// all of that code does a bare registry lookup keyed by the ID string, so
// the ID needs to look like the rest of the catalog to slot in, hence
// `makeCatalogItemId` rather than the workbench's own `field_1` grammar.
//
// The numeric segment must never repeat within a session, even across an
// undo that removes the record it named (a stale reference or a redo could
// otherwise resolve to a different definition under the same ID) -- so it
// is minted from the shared, monotonic IdSequencer (seeded from the
// document on load), never derived by rescanning current document content.
//
// Domain layer: no I/O.
import { makeCatalogItemId } from '../../../surface/ids';
import type { IdSequencer } from '../../domain/ids';
import { parseId } from '../../domain/ids';

const COMPUTED_FIELD_PATH_PREFIX = 'custom.';
const CUSTOM_STUDY_PATH_PREFIX = 'custom.';

// Matches "field.custom.<n>" / "study.custom.<n>" exactly -- anything else
// (a built-in dotted id, or a foreign/malformed string) is not one of ours.
const COMPUTED_FIELD_ID = /^field\.custom\.(\d+)$/;
const CUSTOM_STUDY_ID = /^study\.custom\.(\d+)$/;

export function mintComputedFieldId(ids: IdSequencer): string {
	const parsed = parseId(ids.next('computedfield'));
	return makeCatalogItemId('field', `${COMPUTED_FIELD_PATH_PREFIX}${parsed?.sequence ?? 0}`);
}

export function mintCustomStudyId(ids: IdSequencer): string {
	const parsed = parseId(ids.next('customstudy'));
	return makeCatalogItemId('study', `${CUSTOM_STUDY_PATH_PREFIX}${parsed?.sequence ?? 0}`);
}

function maxSequence(ids: readonly string[], pattern: RegExp): number {
	let max = 0;
	for (const id of ids) {
		const match = pattern.exec(id);
		if (!match || !match[1]) {
			continue;
		}
		max = Math.max(max, Number.parseInt(match[1], 10));
	}
	return max;
}

// Seeds for createIdSequencer, so a reloaded workspace's sequencer resumes
// past every id already stored rather than restarting at 1 and eventually
// re-minting one that's still referenced. Mirrors chart/watchlist/
// filterDraft's own seeding precedent (alertIdSeed exists but is not wired
// into a default composition root today; this ticket follows the more
// careful ones).
export function computedFieldIdSeed(ids: readonly string[]): Record<string, number> {
	return { computedfield: maxSequence(ids, COMPUTED_FIELD_ID) };
}

export function customStudyIdSeed(ids: readonly string[]): Record<string, number> {
	return { customstudy: maxSequence(ids, CUSTOM_STUDY_ID) };
}
