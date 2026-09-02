// The source/renderer plug-point: deliberately separate storage from
// panelKindRegistry.ts even though the shapes mirror each other. A panel's
// kind rarely changes after creation, but its source and renderer change
// routinely -- that is the whole point of the source/renderer split -- so
// they are looked up and revalidated on every relevant mutation rather than
// fixed at creation time like a kind is.
import type { ConfigError, ConfigValidation } from './panelKindRegistry';
import type { PanelSourceRef } from '../domain/panel';

export type { ConfigError, ConfigValidation } from './panelKindRegistry';

export interface SourceTypeDefinition {
	name: string;
	// JSON Schema fragment describing a valid `ref` for this source type.
	refSchema: object;
	validateRef(ref: unknown): ConfigValidation<Record<string, unknown>>;
	// Decides whether a given panel kind + active renderer accepts this
	// source type. Renderer is null when a panel has no renderer chosen yet.
	isCompatible(context: { panelKind: string; renderer: string | null }): boolean;
	compatibilityDescription: string;
}

export interface RendererTypeDefinition<
	TConfig extends Record<string, unknown> = Record<string, unknown>
> {
	name: string;
	configSchema: object;
	validateConfig(input: unknown): ConfigValidation<TConfig>;
	defaultConfig(): TConfig;
	acceptedSourceTypes: string[];
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

export interface SourceRendererRegistry {
	registerSourceType(definition: SourceTypeDefinition): void;
	registerRendererType(definition: RendererTypeDefinition): void;
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
		registerSourceType(definition: SourceTypeDefinition): void {
			if (sourceTypes.has(definition.name)) {
				throw new SourceTypeConflictError(definition.name);
			}
			sourceTypes.set(definition.name, definition);
		},
		registerRendererType(definition: RendererTypeDefinition): void {
			if (rendererTypes.has(definition.name)) {
				throw new RendererTypeConflictError(definition.name);
			}
			rendererTypes.set(definition.name, definition);
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
