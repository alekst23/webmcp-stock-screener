// create_panel, duplicate_panel, remove_panel -- the three tools that add
// or remove a panel entirely, as opposed to reconfiguring an existing one.
import { createPanel, duplicatePanel, removePanel } from '../application';
import type { PanelUseCaseDeps } from '../application';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import { createPanelSchema, duplicatePanelSchema, removePanelSchema } from './schemas';
import { fail, ok, toErrorResult } from './results';
import { fromWireRect, parseContext, type WireGridRect } from './wire';

const always = () => true;

interface CreatePanelInput {
	kind?: unknown;
	title?: unknown;
	config?: unknown;
	source?: { type: string; ref: Record<string, unknown> } | null;
	renderer?: string | null;
	rect?: WireGridRect;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function createPanelTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'create_panel',
		description:
			'Creates a panel of a registered kind, optionally with an explicit title, configuration, ' +
			'initial source, and renderer; auto-places it in the first free grid cell when no rect is ' +
			'given. Returns the mutation envelope; the new panel id is in affected_ids.',
		inputSchema: createPanelSchema(deps),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as CreatePanelInput;
			if (typeof input.kind !== 'string') {
				return fail('"kind" is required.');
			}
			try {
				const envelope = createPanel(deps, {
					context: parseContext(input),
					kind: input.kind,
					title: typeof input.title === 'string' ? input.title : undefined,
					config: input.config as Record<string, unknown> | undefined,
					source: input.source,
					renderer: input.renderer,
					rect: input.rect ? fromWireRect(input.rect) : undefined
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface DuplicatePanelInput {
	panel_id?: unknown;
	symbol_override?: unknown;
	source_override?: { type: string; ref: Record<string, unknown> } | null;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function duplicatePanelTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'duplicate_panel',
		description:
			'Copies an existing panel (kind, configuration, source, renderer) to a new panel with a ' +
			'fresh id and an auto-placed footprint of the same size, optionally overriding the symbol ' +
			'or source. Returns the mutation envelope; the new panel id is in affected_ids.',
		inputSchema: duplicatePanelSchema(deps),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as DuplicatePanelInput;
			if (typeof input.panel_id !== 'string') {
				return fail('"panel_id" is required.');
			}
			try {
				const envelope = duplicatePanel(deps, {
					context: parseContext(input),
					panelId: input.panel_id,
					symbolOverride:
						typeof input.symbol_override === 'string' ? input.symbol_override : undefined,
					sourceOverride: input.source_override
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

interface RemovePanelInput {
	panel_id?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function removePanelTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: 'remove_panel',
		description:
			'Removes a panel by its stable id, dropping it from every link channel and clearing its ' +
			'stored selection. Returns the mutation envelope; affected_ids names the removed panel plus ' +
			'every panel whose link group changed.',
		inputSchema: removePanelSchema(),
		available: always,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as RemovePanelInput;
			if (typeof input.panel_id !== 'string') {
				return fail('"panel_id" is required.');
			}
			try {
				const envelope = removePanel(deps, {
					context: parseContext(input),
					panelId: input.panel_id
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				return toErrorResult(err);
			}
		}
	};
}

export function buildLifecycleTools(deps: PanelUseCaseDeps): ToolSpec[] {
	return [createPanelTool(deps), duplicatePanelTool(deps), removePanelTool(deps)];
}
