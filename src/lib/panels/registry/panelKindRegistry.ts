// The panel-kind plug-point: a sibling epic declares everything the
// container needs to create, validate, place, link, and render a panel of
// one kind, and registers it here at module load -- the container never
// imports the sibling's module directly. Pure registry code: no I/O, no
// Svelte, no WebMCP.
import type { GridSize } from '../domain/grid';
import type { PanelLinkChannel } from '../domain/channels';

export interface ConfigError {
	field: string;
	reason: string;
}

// `warnings` is optional and only ever present on the `ok` arm (T-1010-6,
// AC4): a config can be valid and still carry non-blocking issues -- e.g. a
// results-table sort key that isn't a visible column. Adding it here (rather
// than a results-only type) is additive and backward compatible: every
// existing validator that returns `{ ok: true, value }` with no `warnings`
// field is still a valid ConfigValidation<T>, so no other kind/renderer
// changes behavior.
export type ConfigValidation<T> =
	{ ok: true; value: T; warnings?: ConfigError[] } | { ok: false; errors: ConfigError[] };

export interface PanelKindDefinition<
	TConfig extends Record<string, unknown> = Record<string, unknown>
> {
	kind: string;
	defaultTitle: string;
	defaultSize: GridSize;
	minSize: GridSize;
	defaultConfig(): TConfig;
	validateConfig(input: unknown): ConfigValidation<TConfig>;
	configSchema: object;
	linkChannels: PanelLinkChannel[];
	// Source type names (from the source/renderer registry, T-1007-7) this
	// kind accepts as a binding. Empty means the kind is not data-bound.
	bindingTypes: string[];
	// Renderer applied by create_panel when the caller omits one. null when
	// the kind has no renderer until a source is bound.
	defaultRenderer: string | null;
	// Lazy body loader -- the registry stores this, never a component, so
	// domain/registry code never depends on the rendering layer.
	component(): Promise<unknown>;
}

export class PanelKindConflictError extends Error {
	readonly kind: string;

	constructor(kind: string) {
		super(`Panel kind "${kind}" is already registered.`);
		this.name = 'PanelKindConflictError';
		this.kind = kind;
	}
}

export class UnknownPanelKindError extends Error {
	readonly kind: string;
	readonly registeredKinds: string[];

	constructor(kind: string, registeredKinds: string[]) {
		super(
			registeredKinds.length > 0
				? `Unknown panel kind "${kind}". Registered kinds: ${registeredKinds.join(', ')}.`
				: `Unknown panel kind "${kind}". No panel kinds are registered.`
		);
		this.name = 'UnknownPanelKindError';
		this.kind = kind;
		this.registeredKinds = registeredKinds;
	}
}

export interface RegisterOptions {
	// True for a fallback registered before any sibling epic's real
	// definition is known to exist yet (defaultPanelKinds.ts's own call).
	// A placeholder never conflicts with, and never overwrites, anything --
	// it silently steps aside for a real registration on either side of it
	// in call order (see register()'s own comment for the full truth table).
	placeholder?: boolean;
}

export interface PanelRegistry {
	register(
		definition: PanelKindDefinition<Record<string, unknown>>,
		options?: RegisterOptions
	): void;
	get(kind: string): PanelKindDefinition | undefined;
	require(kind: string): PanelKindDefinition;
	has(kind: string): boolean;
	list(): PanelKindDefinition[];
	names(): string[];
}

// A fresh Map per call -- callers that want isolation (tests, in
// particular) get a registry with no relationship to any other instance,
// including the module-global default below.
export function createPanelRegistry(): PanelRegistry {
	const kinds = new Map<string, PanelKindDefinition>();
	// Names currently holding a placeholder registration, not a real one --
	// tracked separately from `kinds` because "is this entry replaceable"
	// is not recoverable from the definition value itself.
	const placeholders = new Set<string>();

	return {
		// Order-independent by construction (three sibling epics -- results,
		// chart, similarity -- each register a real kind into the same
		// registry a default-seeding call also touches, and call order
		// between the two is a composition-root detail no epic should have
		// to coordinate on). The full truth table, keyed by (what's already
		// there, what this call is registering):
		//   nothing yet      + real        -> inserted as real
		//   nothing yet      + placeholder -> inserted as placeholder
		//   placeholder here + real        -> overwritten by the real one
		//   placeholder here + placeholder -> skipped (one placeholder already covers it)
		//   real here        + placeholder -> skipped (a real registration always wins)
		//   real here        + real        -> PanelKindConflictError (an actual duplicate, still a bug)
		register(
			definition: PanelKindDefinition<Record<string, unknown>>,
			options?: RegisterOptions
		): void {
			const incomingIsPlaceholder = options?.placeholder ?? false;
			const existingIsPlaceholder = placeholders.has(definition.kind);
			if (kinds.has(definition.kind)) {
				if (incomingIsPlaceholder) {
					return;
				}
				if (!existingIsPlaceholder) {
					throw new PanelKindConflictError(definition.kind);
				}
			}
			kinds.set(definition.kind, definition);
			if (incomingIsPlaceholder) {
				placeholders.add(definition.kind);
			} else {
				placeholders.delete(definition.kind);
			}
		},
		get(kind: string): PanelKindDefinition | undefined {
			return kinds.get(kind);
		},
		require(kind: string): PanelKindDefinition {
			const found = kinds.get(kind);
			if (!found) {
				throw new UnknownPanelKindError(kind, Array.from(kinds.keys()));
			}
			return found;
		},
		has(kind: string): boolean {
			return kinds.has(kind);
		},
		list(): PanelKindDefinition[] {
			return Array.from(kinds.values());
		},
		names(): string[] {
			return Array.from(kinds.keys());
		}
	};
}

// Module-global default registry. A sibling epic registers into this
// instance from its own module without ever editing this file.
export const panelKindRegistry: PanelRegistry = createPanelRegistry();

export function registerPanelKind(definition: PanelKindDefinition<Record<string, unknown>>): void {
	panelKindRegistry.register(definition);
}

export function getPanelKind(kind: string): PanelKindDefinition | undefined {
	return panelKindRegistry.get(kind);
}

export function listPanelKinds(): PanelKindDefinition[] {
	return panelKindRegistry.list();
}
