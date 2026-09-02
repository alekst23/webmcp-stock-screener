// A self-contained stable-ID generator for exports (T-1014-10, AC8).
//
// workbench/domain/ids.ts's ResourceKind (EPIC-1006, already merged) has no
// 'export' member, and IdSequencer.next() is typed to that closed union --
// `deps.ids.next('export')` does not compile. Extending that shared,
// already-merged enum is a cross-epic decision this ticket does not
// self-approve (see the ticket doc's Solution Approach). This module mints
// an export id that matches ids.ts's `mintId` grammar cosmetically
// (`export_<n>`) without registering a new kind in the shared registry --
// the id is stable and unique, just not parseable by ids.ts's own
// parseId/isResourceId today.
//
// Domain layer: no I/O, no dependency on the shared ids.ts registry.

import type { ResourceId } from '../../domain/ids';

export type ExportIdGenerator = () => ResourceId;

// `seed` lets a test (or a future persisted high-water mark) continue a
// sequence rather than always restarting at 1, mirroring
// createIdSequencer's own `seed` parameter.
export function createExportIdGenerator(seed = 0): ExportIdGenerator {
	let sequence = seed;
	return (): ResourceId => {
		sequence += 1;
		return `export_${sequence}`;
	};
}
