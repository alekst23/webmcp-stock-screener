// Stable-ID scheme for every resource in the new workbench surface (T-1006-1).
// Every resource is addressed by an opaque, human-legible string carrying its
// kind, an optional discriminator and a never-reused sequence number — never
// a positional index or a bare ticker. See docs/reference/tool-spec.md's
// "Common contract for every tool".

export type ResourceKind =
	| 'workspace'
	| 'panel'
	| 'screener'
	| 'run'
	| 'result'
	| 'change'
	| 'undo'
	| 'link'
	| 'filter'
	| 'study'
	| 'annotation'
	| 'setup'
	| 'watchlist'
	| 'alert'
	| 'preview'
	| 'column'
	| 'rule'
	| 'export'
	| 'backtest'
	// Single words (no underscore), matching this file's own grammar rule
	// below -- 'computed_field'/'custom_study' would parse back with kind
	// 'computed'/'custom', which is not what mintId was given.
	| 'computedfield'
	| 'customstudy';

const RESOURCE_KINDS: ReadonlySet<string> = new Set<ResourceKind>([
	'workspace',
	'panel',
	'screener',
	'run',
	'result',
	'change',
	'undo',
	'link',
	'filter',
	'study',
	'annotation',
	'setup',
	'watchlist',
	'alert',
	'preview',
	'column',
	'rule',
	'export',
	'backtest',
	'computedfield',
	'customstudy'
]);

// Opaque wire type. Grammar: '<kind>_<discriminator?>_<seq>', e.g.
// 'workspace_1' or 'panel_chart_1'. Kinds are single words (no underscores),
// so the grammar is unambiguous to parse back out.
export type ResourceId = string;

export interface ParsedId {
	kind: ResourceKind;
	discriminator?: string;
	sequence: number;
}

export function mintId(kind: ResourceKind, seq: number, discriminator?: string): ResourceId {
	return discriminator ? `${kind}_${discriminator}_${seq}` : `${kind}_${seq}`;
}

// Never throws: an unrecognized or malformed string parses as null.
export function parseId(id: string): ParsedId | null {
	if (typeof id !== 'string' || id.length === 0) {
		return null;
	}
	const parts = id.split('_');
	if (parts.length < 2) {
		return null;
	}
	const kind = parts[0];
	const seqPart = parts[parts.length - 1];
	if (!kind || !RESOURCE_KINDS.has(kind) || !seqPart) {
		return null;
	}
	if (!/^\d+$/.test(seqPart)) {
		return null;
	}
	const sequence = Number.parseInt(seqPart, 10);
	const discriminatorParts = parts.slice(1, -1);
	const discriminator = discriminatorParts.length > 0 ? discriminatorParts.join('_') : undefined;
	return discriminator === undefined
		? { kind: kind as ResourceKind, sequence }
		: { kind: kind as ResourceKind, discriminator, sequence };
}

export function isResourceId(value: unknown, kind?: ResourceKind): value is ResourceId {
	if (typeof value !== 'string') {
		return false;
	}
	const parsed = parseId(value);
	if (!parsed) {
		return false;
	}
	return kind === undefined || parsed.kind === kind;
}

export interface IdSequencer {
	next(kind: ResourceKind, discriminator?: string): ResourceId;
}

function seedKey(kind: ResourceKind, discriminator?: string): string {
	return discriminator ? `${kind}:${discriminator}` : kind;
}

// Sequence numbers only ever increment for a given (kind, discriminator)
// pair — a deleted resource's counter is never reset, so its ID is never
// handed to a later resource. `seed` lets a persisted workspace's stored
// high-water marks continue rather than restarting at 1 after reload.
export function createIdSequencer(seed?: Record<string, number>): IdSequencer {
	const counters = new Map<string, number>(Object.entries(seed ?? {}));
	return {
		next(kind: ResourceKind, discriminator?: string): ResourceId {
			const key = seedKey(kind, discriminator);
			const next = (counters.get(key) ?? 0) + 1;
			counters.set(key, next);
			return mintId(kind, next, discriminator);
		}
	};
}
