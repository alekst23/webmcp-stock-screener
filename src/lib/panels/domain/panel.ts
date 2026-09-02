// The panel entity itself. A panel's kind (what it *is*) is fixed at
// creation and resolved through the panel-kind registry; its source (what
// it shows) and renderer (how it shows it) are independent, mutable, and
// resolved through the separate source/renderer registry. This module knows
// neither registry -- it only shapes the data both operate on.
import type { GridRect } from './grid';

// An opaque reference to a bound data source. `type` names a registered
// source type (e.g. 'screener_results'); `ref` is that type's own shape,
// validated by the source/renderer registry, never interpreted here.
export interface PanelSourceRef {
	type: string;
	ref: Record<string, unknown>;
}

export interface Panel {
	id: string;
	kind: string;
	title: string;
	config: Record<string, unknown>;
	rect: GridRect;
	hidden: boolean;
	collapsed: boolean;
	source: PanelSourceRef | null;
	renderer: string | null;
}

// Plain constructor -- does not mint IDs, does not validate `kind` against
// a registry, does not validate `config` against a kind's or renderer's
// schema. Those all require the registries this module deliberately does
// not import; callers (the use-case layer) validate first and pass in
// already-accepted values.
export function makePanel(input: {
	id: string;
	kind: string;
	title: string;
	config: Record<string, unknown>;
	rect: GridRect;
	hidden?: boolean;
	collapsed?: boolean;
	source?: PanelSourceRef | null;
	renderer?: string | null;
}): Panel {
	return {
		id: input.id,
		kind: input.kind,
		title: input.title,
		config: input.config,
		rect: input.rect,
		hidden: input.hidden ?? false,
		collapsed: input.collapsed ?? false,
		source: input.source ?? null,
		renderer: input.renderer ?? null
	};
}
