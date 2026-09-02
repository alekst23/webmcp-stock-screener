// A named registry of layout templates — footprints in slot order, for
// `apply_layout_template` to assign to panels in workspace order. Kept
// separate from layout.ts's geometry so templates can be added or changed
// without touching placement logic. The default seeded workspace
// arrangement (filter_builder/results_table/chart) is deliberately NOT
// registered here — the spec forbids exposing it as a re-appliable
// template.

import { GRID_COLUMNS, GRID_ROWS, type GridRect } from './grid';

export interface LayoutTemplate {
	name: string;
	slots: GridRect[];
}

export interface LayoutTemplateRegistry {
	register(template: LayoutTemplate): void;
	get(name: string): LayoutTemplate | undefined;
	require(name: string): LayoutTemplate;
	list(): LayoutTemplate[];
	names(): string[];
}

export class LayoutTemplateConflictError extends Error {
	readonly name: string;

	constructor(name: string) {
		super(`Layout template "${name}" is already registered.`);
		this.name = name;
	}
}

export class UnknownLayoutTemplateError extends Error {
	readonly template: string;
	readonly registeredTemplates: string[];

	constructor(template: string, registeredTemplates: string[]) {
		super(
			`Unknown layout template "${template}". Registered templates: ${
				registeredTemplates.length > 0 ? registeredTemplates.join(', ') : '(none)'
			}.`
		);
		this.template = template;
		this.registeredTemplates = registeredTemplates;
	}
}

export function createLayoutTemplateRegistry(): LayoutTemplateRegistry {
	const templates = new Map<string, LayoutTemplate>();

	return {
		register(template: LayoutTemplate): void {
			if (templates.has(template.name)) {
				throw new LayoutTemplateConflictError(template.name);
			}
			templates.set(template.name, template);
		},
		get(name: string): LayoutTemplate | undefined {
			return templates.get(name);
		},
		require(name: string): LayoutTemplate {
			const template = templates.get(name);
			if (template === undefined) {
				throw new UnknownLayoutTemplateError(name, Array.from(templates.keys()));
			}
			return template;
		},
		list(): LayoutTemplate[] {
			return Array.from(templates.values());
		},
		names(): string[] {
			return Array.from(templates.keys());
		}
	};
}

function rect(col: number, row: number, colSpan: number, rowSpan: number): GridRect {
	return { col, row, colSpan, rowSpan };
}

// Three even columns, each spanning the full grid height.
function threeColumnsTemplate(): LayoutTemplate {
	const colSpan = GRID_COLUMNS / 3;
	return {
		name: 'three_columns',
		slots: [
			rect(0, 0, colSpan, GRID_ROWS),
			rect(colSpan, 0, colSpan, GRID_ROWS),
			rect(colSpan * 2, 0, colSpan, GRID_ROWS)
		]
	};
}

// Four even quadrants.
function quadTemplate(): LayoutTemplate {
	const colSpan = GRID_COLUMNS / 2;
	const rowSpan = GRID_ROWS / 2;
	return {
		name: 'quad',
		slots: [
			rect(0, 0, colSpan, rowSpan),
			rect(colSpan, 0, colSpan, rowSpan),
			rect(0, rowSpan, colSpan, rowSpan),
			rect(colSpan, rowSpan, colSpan, rowSpan)
		]
	};
}

// 9 slots (3 columns x 3 row-bands) tiling the 6x4 grid exactly. 6 columns
// split evenly into 3 bands of 2, but 4 rows do not split evenly into 3 —
// so the third row-band is given double height (rows 2-3) while the first
// two get a single row each (rows 0, 1): 1 + 1 + 2 = 4, every slot keeps a
// >=1x1 footprint, and there is no gap or overflow past row 4.
function chartWall3x3Template(): LayoutTemplate {
	const colSpan = GRID_COLUMNS / 3;
	const cols = [0, colSpan, colSpan * 2];
	const rowBands: Array<{ row: number; rowSpan: number }> = [
		{ row: 0, rowSpan: 1 },
		{ row: 1, rowSpan: 1 },
		{ row: 2, rowSpan: 2 }
	];

	const slots: GridRect[] = [];
	for (const band of rowBands) {
		for (const col of cols) {
			slots.push(rect(col, band.row, colSpan, band.rowSpan));
		}
	}

	return { name: 'chart_wall_3x3', slots };
}

// One large focus panel (left 4 columns) plus a two-item sidebar (right 2
// columns, stacked).
function focusWithSidebarTemplate(): LayoutTemplate {
	const sidebarCol = GRID_COLUMNS - 2;
	const sidebarRowSpan = GRID_ROWS / 2;
	return {
		name: 'focus_with_sidebar',
		slots: [
			rect(0, 0, sidebarCol, GRID_ROWS),
			rect(sidebarCol, 0, 2, sidebarRowSpan),
			rect(sidebarCol, sidebarRowSpan, 2, sidebarRowSpan)
		]
	};
}

export function registerDefaultLayoutTemplates(registry: LayoutTemplateRegistry): void {
	registry.register(threeColumnsTemplate());
	registry.register(quadTemplate());
	registry.register(chartWall3x3Template());
	registry.register(focusWithSidebarTemplate());
}

export const layoutTemplateRegistry: LayoutTemplateRegistry = createLayoutTemplateRegistry();
registerDefaultLayoutTemplates(layoutTemplateRegistry);
