// link_panels, unlink_panels, set_panel_selection -- cross-panel
// synchronization.
import { linkPanels, setPanelSelection, unlinkPanels } from '../application';
import type { PanelUseCaseDeps } from '../application';
import { isPanelLinkChannel } from '../domain/channels';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import { linkPanelsSchema, setPanelSelectionSchema, unlinkPanelsSchema } from './schemas';
import { fail, ok, toErrorResult } from './results';
import { parseContext } from './wire';

const always = () => true;

interface LinkPanelsInput {
	channel?: unknown;
	panel_ids?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function linkPanelsTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'link_panels',
		description:
			"Joins panels into one channel's synchronization group (symbol, timeframe, " +
			"result_selection, crosshair, or filters), rejecting a panel whose kind doesn't declare " +
			'that channel. Returns the mutation envelope.',
		inputSchema: linkPanelsSchema(),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as LinkPanelsInput;
			if (!isPanelLinkChannel(input.channel) || !Array.isArray(input.panel_ids)) {
				return fail(
					'"channel" and "panel_ids" are required; channel must be a registered channel.'
				);
			}
			try {
				const envelope = linkPanels(deps, {
					context: parseContext(input),
					channel: input.channel,
					panelIds: input.panel_ids as string[]
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface UnlinkPanelsInput {
	channel?: unknown;
	panel_ids?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function unlinkPanelsTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'unlink_panels',
		description:
			"Removes panels from one channel's synchronization group. Returns the mutation envelope.",
		inputSchema: unlinkPanelsSchema(),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as UnlinkPanelsInput;
			if (!isPanelLinkChannel(input.channel) || !Array.isArray(input.panel_ids)) {
				return fail(
					'"channel" and "panel_ids" are required; channel must be a registered channel.'
				);
			}
			try {
				const envelope = unlinkPanels(deps, {
					context: parseContext(input),
					channel: input.channel,
					panelIds: input.panel_ids as string[]
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface SetPanelSelectionInput {
	panel_id?: unknown;
	selected_ids?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function setPanelSelectionTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'set_panel_selection',
		description:
			"Sets a panel's selected result ids (an empty array clears the selection) and propagates " +
			'the same value to every panel linked on the result_selection channel. Returns the mutation ' +
			'envelope.',
		inputSchema: setPanelSelectionSchema(),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as SetPanelSelectionInput;
			if (typeof input.panel_id !== 'string' || !Array.isArray(input.selected_ids)) {
				return fail('"panel_id" and "selected_ids" are required.');
			}
			try {
				const envelope = setPanelSelection(deps, {
					context: parseContext(input),
					panelId: input.panel_id,
					selectedIds: input.selected_ids as string[]
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

export function buildLinkTools(deps: PanelUseCaseDeps): ToolSpec[] {
	return [linkPanelsTool(deps), unlinkPanelsTool(deps), setPanelSelectionTool(deps)];
}
