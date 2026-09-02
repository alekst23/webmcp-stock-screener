// Pure cell-value formatting shared by every results-table cell (T-1010-7).
// No locale/currency lookups here -- formatting stays generic across value
// types; a currency- or percent-aware presentation is out of scope for this
// ticket (not required by any acceptance criterion) and would need
// catalog-level unit semantics this module deliberately does not have.
import type { ColumnValue } from '../domain/projection';

// An em dash, not "N/A" or "-": distinguishes an honest absence from a
// value that merely looks short, matching this area's "never fabricate"
// convention (see projection.ts's own resolveIdentityValue comment).
const ABSENT = '—';

export function formatColumnValue(value: ColumnValue, unit: string | null): string {
	if (value === null) {
		return ABSENT;
	}
	if (typeof value === 'boolean') {
		return value ? 'Yes' : 'No';
	}
	if (typeof value === 'number') {
		const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
		return unit ? `${formatted} ${unit}` : formatted;
	}
	return unit ? `${value} ${unit}` : value;
}
