// Fallback columns rendered when a results_table panel's configuration has
// no display columns yet (defaultResultsTableConfig()/
// defaultWireResultsTableConfig() both yield `columns: []`) -- the base
// identity fields every ResultRow already carries (T-1010-2), so an
// unconfigured table still shows something meaningful instead of literally
// nothing. A rendering-layer decision, not a domain one: AC2 only requires
// that *configured* columns render in the *configured* order.
import type { ColumnValue, ProjectedRow } from '../domain/projection';
import type { DisplayColumn } from '../domain/tableConfig';

export interface RenderColumn {
	id: string;
	label: string;
	unit: string | null;
	accessor: (row: ProjectedRow) => ColumnValue;
}

export const DEFAULT_RENDER_COLUMNS: readonly RenderColumn[] = [
	{ id: '__rank', label: 'Rank', unit: null, accessor: (row) => row.rank },
	{
		id: '__instrument',
		label: 'Instrument',
		unit: null,
		accessor: (row) => row.ticker ?? row.instrumentId
	},
	{ id: '__score', label: 'Score', unit: null, accessor: (row) => row.compositeScore }
];

export function renderColumnsFor(configured: readonly DisplayColumn[]): RenderColumn[] {
	if (configured.length === 0) {
		return [...DEFAULT_RENDER_COLUMNS];
	}
	return configured.map((column) => ({
		id: column.id,
		label: column.label,
		unit: column.unit ?? null,
		accessor: (row: ProjectedRow) => row.columns[column.id] ?? null
	}));
}
