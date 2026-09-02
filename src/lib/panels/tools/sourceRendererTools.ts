// bind_panel_source, set_panel_renderer, configure_chart_grid,
// configure_panel_view -- the four tools that change what a panel shows
// and how, independently of its kind or footprint.
import {
	bindPanelSource,
	configureChartGrid,
	configurePanelView,
	setPanelRenderer
} from '../application';
import type { PanelUseCaseDeps } from '../application';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import {
	bindPanelSourceSchema,
	configureChartGridSchema,
	configurePanelViewSchema,
	setPanelRendererSchema
} from './schemas';
import { fail, ok, toErrorResult } from './results';
import { parseContext } from './wire';

const always = () => true;

interface BindPanelSourceInput {
	panel_id?: unknown;
	source?: { type: string; ref: Record<string, unknown> };
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function bindPanelSourceTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'bind_panel_source',
		description:
			'Connects a panel to a data source (a screener run, a watchlist, a symbol list, or another ' +
			"panel), rejecting a source type the panel's kind or active renderer doesn't accept. Never " +
			"changes the panel's renderer. Returns the mutation envelope.",
		inputSchema: bindPanelSourceSchema(deps),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as BindPanelSourceInput;
			if (typeof input.panel_id !== 'string' || !input.source) {
				return fail('"panel_id" and "source" are required.');
			}
			try {
				const envelope = bindPanelSource(deps, {
					context: parseContext(input),
					panelId: input.panel_id,
					source: input.source
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface SetPanelRendererInput {
	panel_id?: unknown;
	renderer?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function setPanelRendererTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'set_panel_renderer',
		description:
			"Changes a panel's renderer (e.g. table, chart grid, heatmap, scatter plot) without " +
			"changing its source, keeping configuration fields the new renderer's contract still " +
			'recognizes and dropping the rest (reported as a warning, not an error). Returns the ' +
			'mutation envelope.',
		inputSchema: setPanelRendererSchema(deps),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as SetPanelRendererInput;
			if (typeof input.panel_id !== 'string' || typeof input.renderer !== 'string') {
				return fail('"panel_id" and "renderer" are required.');
			}
			try {
				const envelope = setPanelRenderer(deps, {
					context: parseContext(input),
					panelId: input.panel_id,
					renderer: input.renderer
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface ConfigureChartGridInput {
	panel_id?: unknown;
	rows?: unknown;
	columns?: unknown;
	item_count?: unknown;
	page?: unknown;
	page_size?: unknown;
	shared_studies?: unknown;
	chart_settings?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function configureChartGridTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'configure_chart_grid',
		description:
			'Sets rows, columns, item count, pagination, shared studies, and chart settings for a panel ' +
			'whose renderer is "chart_grid", validated against that renderer\'s own contract. Returns ' +
			'the mutation envelope.',
		inputSchema: configureChartGridSchema(deps),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as ConfigureChartGridInput;
			if (typeof input.panel_id !== 'string') {
				return fail('"panel_id" is required.');
			}
			try {
				const envelope = configureChartGrid(deps, {
					context: parseContext(input),
					panelId: input.panel_id,
					rows: input.rows as number | undefined,
					columns: input.columns as number | undefined,
					itemCount: input.item_count as number | undefined,
					page: input.page as number | undefined,
					pageSize: input.page_size as number | undefined,
					sharedStudies: input.shared_studies as string[] | undefined,
					chartSettings: input.chart_settings as Record<string, unknown> | undefined
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface ConfigurePanelViewInput {
	panel_id?: unknown;
	title?: unknown;
	hidden?: unknown;
	collapsed?: unknown;
	config?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function configurePanelViewTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'configure_panel_view',
		description:
			'Sets title, visibility, collapsed state, and renderer-specific view configuration ' +
			'(columns, studies, axes, sorting, grouping, formatting), each optional -- only the fields ' +
			'supplied are applied. Returns the mutation envelope.',
		inputSchema: configurePanelViewSchema(deps),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as ConfigurePanelViewInput;
			if (typeof input.panel_id !== 'string') {
				return fail('"panel_id" is required.');
			}
			try {
				const envelope = configurePanelView(deps, {
					context: parseContext(input),
					panelId: input.panel_id,
					title: typeof input.title === 'string' ? input.title : undefined,
					hidden: typeof input.hidden === 'boolean' ? input.hidden : undefined,
					collapsed: typeof input.collapsed === 'boolean' ? input.collapsed : undefined,
					config: input.config as Record<string, unknown> | undefined
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

export function buildSourceRendererTools(deps: PanelUseCaseDeps): ToolSpec[] {
	return [
		bindPanelSourceTool(deps),
		setPanelRendererTool(deps),
		configureChartGridTool(deps),
		configurePanelViewTool(deps)
	];
}
