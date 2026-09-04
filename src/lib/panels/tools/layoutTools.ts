// set_panel_layout, apply_layout_template, split_panel: the three
// revisioned geometry tools. maximize_panel lives here too since it's
// geometry-shaped output (rendered rects) despite being the one tool that
// consumes no revision (T-1007-4 AC10).
import {
	applyLayoutTemplate,
	renderedRects,
	resetLayout,
	setPanelLayout,
	splitPanel
} from '../application';
import type { PanelUseCaseDeps } from '../application';
import { PanelOperationError } from '../application';
import { readPanelState, emptyPanelState } from '../application';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import {
	applyLayoutTemplateSchema,
	maximizePanelSchema,
	resetLayoutSchema,
	setPanelLayoutSchema,
	splitPanelSchema
} from './schemas';
import { fail, ok, toErrorResult } from './results';
import { fromWireRect, parseContext, toWireOccupiedRect, type WireGridRect } from './wire';

const always = () => true;

interface SetPanelLayoutInput {
	placements?: { panel_id: string; rect: WireGridRect }[];
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function setPanelLayoutTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'set_panel_layout',
		description:
			'Applies a batch of panel footprints (grid cells only) atomically -- panels not named in ' +
			'the batch keep their current footprint. Returns the mutation envelope.',
		inputSchema: setPanelLayoutSchema(),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as SetPanelLayoutInput;
			if (!Array.isArray(input.placements) || input.placements.length === 0) {
				return fail('"placements" must be a non-empty array.');
			}
			try {
				const envelope = setPanelLayout(deps, {
					context: parseContext(input),
					placements: input.placements.map((p) => ({
						panelId: p.panel_id,
						rect: fromWireRect(p.rect)
					}))
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface ApplyLayoutTemplateInput {
	template_name?: unknown;
	panel_ids?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function applyLayoutTemplateTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'apply_layout_template',
		description:
			"Applies a registered layout template's footprints to the given panels, in slot order, " +
			"atomically. The number of panel ids must equal the template's slot count. Returns the " +
			'mutation envelope.',
		inputSchema: applyLayoutTemplateSchema(deps),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as ApplyLayoutTemplateInput;
			if (typeof input.template_name !== 'string' || !Array.isArray(input.panel_ids)) {
				return fail('"template_name" and "panel_ids" are required.');
			}
			try {
				const envelope = applyLayoutTemplate(deps, {
					context: parseContext(input),
					templateName: input.template_name,
					panelIds: input.panel_ids as string[]
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface SplitPanelInput {
	panel_id?: unknown;
	direction?: unknown;
	title?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function splitPanelTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'split_panel',
		description:
			"Divides one panel's footprint in two along a horizontal or vertical line, creating a new " +
			'panel (same kind, configuration, source, and renderer) in the freed half. Returns the ' +
			'mutation envelope; affected_ids names both the original and the new panel.',
		inputSchema: splitPanelSchema(),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as SplitPanelInput;
			if (typeof input.panel_id !== 'string' || typeof input.direction !== 'string') {
				return fail('"panel_id" and "direction" are required.');
			}
			if (input.direction !== 'horizontal' && input.direction !== 'vertical') {
				return fail('"direction" must be "horizontal" or "vertical".');
			}
			try {
				const envelope = splitPanel(deps, {
					context: parseContext(input),
					panelId: input.panel_id,
					direction: input.direction,
					title: typeof input.title === 'string' ? input.title : undefined
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface ResetLayoutInput {
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

// hotfix/panel-system: agent-invokable parity with the header's Reset
// control (panelController.ts's resetLayoutByHuman) -- both call the same
// resetLayout use case, tagged with different actors.
function resetLayoutTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'reset_layout',
		description:
			"Replaces the workspace's current panel arrangement with the default seeded layout, " +
			'atomically. Returns the mutation envelope.',
		inputSchema: resetLayoutSchema(),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as ResetLayoutInput;
			try {
				const envelope = resetLayout(deps, { context: parseContext(input) });
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

export interface MaximizedPanelHandle {
	get(): string | null;
	set(id: string | null): void;
}

interface MaximizePanelInput {
	panel_id?: unknown;
}

// The one tool in this epic that never touches the workspace: no
// expected_revision/idempotency_key in its schema, no mutation envelope
// in its result (T-1007-4 AC10). It reads the panel list straight off the
// repository rather than going through commitPanelChange.
function maximizePanelTool(deps: PanelUseCaseDeps & { maximized: MaximizedPanelHandle }): ToolSpec {
	return {
		name: 'maximize_panel',
		description:
			'Temporarily renders one panel at the full grid without changing the saved layout -- ' +
			'client-state only: consumes no revision and returns no mutation envelope. Pass no panel_id ' +
			'to clear the maximized state and restore every panel to its saved footprint. Returns the ' +
			'currently maximized panel id (or null) and the rects that should actually render.',
		inputSchema: maximizePanelSchema(),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as MaximizePanelInput;
			const panelId = typeof input.panel_id === 'string' ? input.panel_id : null;

			const doc = deps.repository.get(deps.workspaceId);
			const state = doc ? readPanelState(doc) : emptyPanelState();
			if (panelId !== null && !state.panels.some((p) => p.id === panelId)) {
				return toErrorResult(
					new PanelOperationError('unknown_panel', `Unknown panel "${panelId}".`, { panelId })
				);
			}

			deps.maximized.set(panelId);
			const rects = renderedRects(state.panels, deps.maximized.get());
			return ok({
				maximized_panel_id: deps.maximized.get(),
				rendered_rects: rects.map(toWireOccupiedRect)
			});
		}
	};
}

export function buildLayoutTools(
	deps: PanelUseCaseDeps & { maximized: MaximizedPanelHandle }
): ToolSpec[] {
	return [
		setPanelLayoutTool(deps),
		applyLayoutTemplateTool(deps),
		splitPanelTool(deps),
		maximizePanelTool(deps),
		resetLayoutTool(deps)
	];
}
