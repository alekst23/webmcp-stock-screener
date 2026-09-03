// The source/renderer plug-point: deliberately separate storage from
// panelKindRegistry.ts even though the shapes mirror each other. A panel's
// kind rarely changes after creation, but its source and renderer change
// routinely -- that is the whole point of the source/renderer split -- so
// they are looked up and revalidated on every relevant mutation rather than
// fixed at creation time like a kind is.
import type { ConfigError, ConfigValidation } from './panelKindRegistry';
import type { Panel, PanelSourceRef } from '../domain/panel';
// Not a cycle risk the way application/support.ts's PanelUseCaseDeps would
// be (see this file's own comment on SelectionValidationInput.deps below):
// workbench/domain/workspace.ts is a leaf domain module with no dependency
// back onto this registry.
import type { WorkspaceDocument } from '../../workbench/domain/workspace';

export type { ConfigError, ConfigValidation } from './panelKindRegistry';

// T-1010-6, AC5-AC9: setPanelSelection.ts had no per-renderer validation hook
// at all before this ticket -- it stored and propagated `selectedIds`
// completely unchecked, which made "reject a result id that isn't part of
// this panel's run" (AC6) impossible to implement anywhere. `deps` is typed
// `unknown` rather than as EPIC-1007's own PanelUseCaseDeps deliberately:
// PanelUseCaseDeps lives in application/support.ts, which already imports
// this file's SourceRendererRegistry type, so typing it precisely here would
// create a cycle. A renderer that needs more than `selectedIds`/`panel` (this
// epic's table contract needs a PinnedRunStore) closes over its own
// dependency at registration time instead, the same way chartSourceTypeDefinition
// closes over ChartSourceDeps -- see chartRendererContract.ts.
export interface SelectionValidationInput {
	selectedIds: string[];
	panel: Panel;
	deps: unknown;
}

export type SelectionValidation = { ok: true } | { ok: false; errors: ConfigError[] };

export interface SourceTypeDefinition {
	name: string;
	// JSON Schema fragment describing a valid `ref` for this source type.
	refSchema: object;
	validateRef(ref: unknown): ConfigValidation<Record<string, unknown>>;
	// Decides whether a given panel kind + active renderer accepts this
	// source type. Renderer is null when a panel has no renderer chosen yet.
	isCompatible(context: { panelKind: string; renderer: string | null }): boolean;
	compatibilityDescription: string;
	// Optional (bug fix, see git history): a source type whose binding has a
	// real effect beyond `panel.source` itself defines this to fold that
	// effect into the same document bindPanelSource.ts is already writing
	// (via PanelMutationResult.documentPatch, application/support.ts). The
	// chart source type is the motivating case: its `ref` carries an
	// instrument/timeframe/range/comparisons that live in the chart
	// extension (readChartData/ChartPanelBody.svelte read that, never
	// panel.source) -- without this hook, bind_panel_source validated and
	// stored the source ref correctly but the chart engine never saw it, so
	// the panel kept refusing "no chart on it" after a successful bind.
	// Absent means no further effect, which is every source type's real
	// behavior before this hook existed -- adding it changes nothing for a
	// source type that doesn't define it. Receives the already-validated
	// `value` from validateRef, never the raw caller input.
	applyBinding?(
		doc: WorkspaceDocument,
		panelId: string,
		ref: Record<string, unknown>
	): WorkspaceDocument;
}

export interface RendererTypeDefinition<
	TConfig extends Record<string, unknown> = Record<string, unknown>
> {
	name: string;
	configSchema: object;
	validateConfig(input: unknown): ConfigValidation<TConfig>;
	defaultConfig(): TConfig;
	acceptedSourceTypes: string[];
	// T-1010-6, AC2: optional plain-language description of what changed
	// between two of this renderer's own configs, used by configurePanelView
	// in place of its generic "view configuration updated" text. A renderer
	// that doesn't define this keeps that generic text -- unchanged behavior.
	describeConfigChange?(input: { previous: TConfig; next: TConfig }): string;
	// T-1010-6, AC7: how many result ids this renderer can display at once
	// when a selection is propagated to it over a link. Undefined/'multiple'
	// is the original, unrestricted propagation behavior every renderer
	// registered before this field existed already has.
	selectionCapacity?: 'single' | 'multiple';
	// T-1010-6, AC6: renderer-specific validation of an incoming selection
	// (e.g. "is every id part of the run this panel is showing?"). Only
	// invoked when the panel's active renderer defines it -- a renderer that
	// doesn't keeps its original "accept anything" behavior.
	validateSelection?(input: SelectionValidationInput): SelectionValidation;
}

// `name` intentionally holds the conflicting source type's name, not the
// error class's own name (unlike the class-identity convention elsewhere in
// this codebase) -- it mirrors PanelKindConflictError.kind, whose
// equivalent field here is naturally called `name` since that is the
// SourceTypeDefinition field it echoes.
export class SourceTypeConflictError extends Error {
	readonly name: string;

	constructor(name: string) {
		super(`Source type "${name}" is already registered.`);
		this.name = name;
	}
}

export class RendererTypeConflictError extends Error {
	readonly name: string;

	constructor(name: string) {
		super(`Renderer type "${name}" is already registered.`);
		this.name = name;
	}
}

export class UnknownSourceTypeError extends Error {
	readonly sourceType: string;
	readonly registeredTypes: string[];

	constructor(sourceType: string, registeredTypes: string[]) {
		super(
			registeredTypes.length > 0
				? `Unknown source type "${sourceType}". Registered source types: ${registeredTypes.join(', ')}.`
				: `Unknown source type "${sourceType}". No source types are registered.`
		);
		this.name = 'UnknownSourceTypeError';
		this.sourceType = sourceType;
		this.registeredTypes = registeredTypes;
	}
}

export class UnknownRendererTypeError extends Error {
	readonly renderer: string;
	readonly registeredTypes: string[];

	constructor(renderer: string, registeredTypes: string[]) {
		super(
			registeredTypes.length > 0
				? `Unknown renderer type "${renderer}". Registered renderer types: ${registeredTypes.join(', ')}.`
				: `Unknown renderer type "${renderer}". No renderer types are registered.`
		);
		this.name = 'UnknownRendererTypeError';
		this.renderer = renderer;
		this.registeredTypes = registeredTypes;
	}
}

export type SourceValidation =
	| { ok: true; value: PanelSourceRef }
	| { ok: false; errors: ConfigError[]; acceptedSourceTypes: string[] };

export interface RendererMigration {
	config: Record<string, unknown>;
	// Field names present in the old config that the new renderer's schema
	// does not recognize, and were therefore dropped rather than carried over.
	dropped: string[];
}

// See panelKindRegistry.ts's identically-shaped RegisterOptions/register()
// comment for the full truth table this option drives -- both registries
// implement the same order-independent placeholder/real precedence rule.
export interface RegisterOptions {
	placeholder?: boolean;
}

export interface SourceRendererRegistry {
	registerSourceType(definition: SourceTypeDefinition, options?: RegisterOptions): void;
	registerRendererType(definition: RendererTypeDefinition, options?: RegisterOptions): void;
	getSourceType(name: string): SourceTypeDefinition | undefined;
	requireSourceType(name: string): SourceTypeDefinition;
	getRendererType(name: string): RendererTypeDefinition | undefined;
	requireRendererType(name: string): RendererTypeDefinition;
	listSourceTypes(): SourceTypeDefinition[];
	listRendererTypes(): RendererTypeDefinition[];
	sourceTypeNames(): string[];
	rendererTypeNames(): string[];
	validateSource(input: {
		source: unknown;
		panelKind: string;
		renderer: string | null;
	}): SourceValidation;
	validateRendererConfig(
		renderer: string,
		input: unknown
	): ConfigValidation<Record<string, unknown>>;
	migrateConfig(input: {
		from: string | null;
		to: string;
		config: Record<string, unknown>;
	}): RendererMigration;
	renderersAcceptingSource(sourceType: string): string[];
}

function isSourceShape(input: unknown): input is { type: string; ref: unknown } {
	if (typeof input !== 'object' || input === null) {
		return false;
	}
	const candidate = input as Record<string, unknown>;
	return typeof candidate.type === 'string';
}

// Recognizing which config fields survive a renderer switch is driven by
// the target renderer's own JSON Schema rather than a hardcoded per-renderer
// field list -- the schema IS the renderer's config contract, so a second
// hand-maintained list would drift from it the moment a renderer's schema
// changes.
function recognizedFieldNames(configSchema: object): Set<string> {
	const properties = (configSchema as { properties?: Record<string, unknown> }).properties;
	return new Set(properties ? Object.keys(properties) : []);
}

export function createSourceRendererRegistry(): SourceRendererRegistry {
	const sourceTypes = new Map<string, SourceTypeDefinition>();
	const rendererTypes = new Map<string, RendererTypeDefinition>();
	// Names currently holding a placeholder registration -- see
	// panelKindRegistry.ts's identical convention for why this can't be
	// recovered from the stored definition itself.
	const placeholderSourceTypes = new Set<string>();
	const placeholderRendererTypes = new Set<string>();

	// Shared by registerSourceType/registerRendererType below -- the same
	// order-independent precedence rule (real always wins, two reals still
	// conflict, a placeholder never conflicts) applies identically to both
	// maps, so the truth table logic itself is written once.
	function upsert<T>(
		map: Map<string, T>,
		placeholders: Set<string>,
		name: string,
		definition: T,
		incomingIsPlaceholder: boolean,
		onConflict: () => never
	): void {
		if (map.has(name)) {
			if (incomingIsPlaceholder) {
				return;
			}
			if (!placeholders.has(name)) {
				onConflict();
			}
		}
		map.set(name, definition);
		if (incomingIsPlaceholder) {
			placeholders.add(name);
		} else {
			placeholders.delete(name);
		}
	}

	function requireSourceType(name: string): SourceTypeDefinition {
		const found = sourceTypes.get(name);
		if (!found) {
			throw new UnknownSourceTypeError(name, Array.from(sourceTypes.keys()));
		}
		return found;
	}

	function requireRendererType(name: string): RendererTypeDefinition {
		const found = rendererTypes.get(name);
		if (!found) {
			throw new UnknownRendererTypeError(name, Array.from(rendererTypes.keys()));
		}
		return found;
	}

	function acceptedSourceTypeNames(panelKind: string, renderer: string | null): string[] {
		return Array.from(sourceTypes.values())
			.filter((sourceType) => sourceType.isCompatible({ panelKind, renderer }))
			.map((sourceType) => sourceType.name);
	}

	return {
		registerSourceType(definition: SourceTypeDefinition, options?: RegisterOptions): void {
			upsert(
				sourceTypes,
				placeholderSourceTypes,
				definition.name,
				definition,
				options?.placeholder ?? false,
				() => {
					throw new SourceTypeConflictError(definition.name);
				}
			);
		},
		registerRendererType(definition: RendererTypeDefinition, options?: RegisterOptions): void {
			upsert(
				rendererTypes,
				placeholderRendererTypes,
				definition.name,
				definition,
				options?.placeholder ?? false,
				() => {
					throw new RendererTypeConflictError(definition.name);
				}
			);
		},
		getSourceType(name: string): SourceTypeDefinition | undefined {
			return sourceTypes.get(name);
		},
		requireSourceType,
		getRendererType(name: string): RendererTypeDefinition | undefined {
			return rendererTypes.get(name);
		},
		requireRendererType,
		listSourceTypes(): SourceTypeDefinition[] {
			return Array.from(sourceTypes.values());
		},
		listRendererTypes(): RendererTypeDefinition[] {
			return Array.from(rendererTypes.values());
		},
		sourceTypeNames(): string[] {
			return Array.from(sourceTypes.keys());
		},
		rendererTypeNames(): string[] {
			return Array.from(rendererTypes.keys());
		},
		validateSource(input: {
			source: unknown;
			panelKind: string;
			renderer: string | null;
		}): SourceValidation {
			const accepted = acceptedSourceTypeNames(input.panelKind, input.renderer);

			if (!isSourceShape(input.source)) {
				return {
					ok: false,
					errors: [{ field: 'source', reason: 'must be an object with a "type" field' }],
					acceptedSourceTypes: accepted
				};
			}

			const sourceType = sourceTypes.get(input.source.type);
			if (!sourceType) {
				return {
					ok: false,
					errors: [{ field: 'source.type', reason: `unknown source type "${input.source.type}"` }],
					acceptedSourceTypes: accepted
				};
			}

			if (!accepted.includes(sourceType.name)) {
				return {
					ok: false,
					errors: [
						{
							field: 'source.type',
							reason: `"${sourceType.name}" is not accepted here: ${sourceType.compatibilityDescription}`
						}
					],
					acceptedSourceTypes: accepted
				};
			}

			const refValidation = sourceType.validateRef(input.source.ref);
			if (!refValidation.ok) {
				return { ok: false, errors: refValidation.errors, acceptedSourceTypes: accepted };
			}

			return { ok: true, value: { type: sourceType.name, ref: refValidation.value } };
		},
		validateRendererConfig(
			renderer: string,
			input: unknown
		): ConfigValidation<Record<string, unknown>> {
			return requireRendererType(renderer).validateConfig(input);
		},
		migrateConfig(input: {
			from: string | null;
			to: string;
			config: Record<string, unknown>;
		}): RendererMigration {
			const target = requireRendererType(input.to);
			const recognized = recognizedFieldNames(target.configSchema);

			const config: Record<string, unknown> = {};
			const dropped: string[] = [];
			for (const [field, value] of Object.entries(input.config)) {
				if (recognized.has(field)) {
					config[field] = value;
				} else {
					dropped.push(field);
				}
			}

			return { config, dropped };
		},
		renderersAcceptingSource(sourceType: string): string[] {
			return Array.from(rendererTypes.values())
				.filter((renderer) => renderer.acceptedSourceTypes.includes(sourceType))
				.map((renderer) => renderer.name);
		}
	};
}

// Module-global default registry. A sibling epic registers into this
// instance from its own module without ever editing this file.
export const sourceRendererRegistry: SourceRendererRegistry = createSourceRendererRegistry();

export function registerSourceType(definition: SourceTypeDefinition): void {
	sourceRendererRegistry.registerSourceType(definition);
}

export function registerRendererType(definition: RendererTypeDefinition): void {
	sourceRendererRegistry.registerRendererType(definition);
}
