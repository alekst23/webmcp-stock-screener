// A stable-ID generator for exports (T-1014-10, AC8).
//
// 'export' is now a registered ResourceKind in workbench/domain/ids.ts
// (EPIC-1006's shared, canonical stable-ID registry), so this generator
// mints through that registry's own IdSequencer rather than keeping a
// private counter -- export ids share the same never-reused-sequence
// mechanism as every other resource kind and are recognized by ids.ts's
// own parseId/isResourceId, instead of only cosmetically resembling its
// grammar. See docs/plan/EPIC-1014/T-1014-10-export-results.md's Solution
// Approach for why this ticket originally avoided extending that enum, and
// the epic's cross-epic review note for why the extension was approved.
//
// Domain layer: no I/O; depends only on the shared ids.ts contract.

import { type IdSequencer, type ResourceId } from '../../domain/ids';

export type ExportIdGenerator = () => ResourceId;

export function createExportIdGenerator(ids: IdSequencer): ExportIdGenerator {
	return (): ResourceId => ids.next('export');
}
