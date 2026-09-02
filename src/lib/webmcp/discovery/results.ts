// Result shaping shared by the three discovery tools.
//
// `ok` / `fail` mirror the shapes in webmcp/tools.ts rather than importing
// them: EPIC-1008 ships the replacement surface alongside the existing
// 11-tool one and must not touch it, and a two-line JSON wrapper is a cheaper
// duplication than a coupling between a surface being built and one being
// retired (EPIC-1015). When the old surface goes, these become the only copy.

import { makeProvenance, type MarketDataProvenance } from '../../surface/provenance';
import type { ToolResult } from '../types';

export function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function fail(message: string, extra?: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
		isError: true
	};
}

export const CATALOG_SOURCE_ID = 'src.catalog.builtin';

// The catalog ships with the application, so `static` is the honest liveness
// and there is no currency, price adjustment or reporting period to state --
// a catalog entry has no monetary content. `asOf` is call time because the
// inventory is whatever this build contains.
export function catalogProvenance(): MarketDataProvenance {
	return makeProvenance({
		asOf: new Date().toISOString(),
		sourceId: CATALOG_SOURCE_ID,
		sourceLabel: 'Built-in application catalog',
		liveness: 'static',
		timezone: 'UTC'
	});
}

// Every discovery tool takes a free-text or ID argument off an untyped bridge
// payload. A bridge is not obliged to enforce the declared inputSchema, so the
// handler re-checks rather than trusting it.
export function readStringArg(input: unknown, key: string): string | undefined {
	if (typeof input !== 'object' || input === null) {
		return undefined;
	}
	const value = (input as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}

export function readArg(input: unknown, key: string): unknown {
	if (typeof input !== 'object' || input === null) {
		return undefined;
	}
	return (input as Record<string, unknown>)[key];
}

export function readStringArrayArg(input: unknown, key: string): string[] | undefined {
	const value = readArg(input, key);
	if (!Array.isArray(value)) {
		return undefined;
	}
	const strings = value.filter((entry): entry is string => typeof entry === 'string');
	return strings.length > 0 ? strings : undefined;
}

export function readNumberArg(input: unknown, key: string): number | undefined {
	const value = readArg(input, key);
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBooleanArg(input: unknown, key: string): boolean | undefined {
	const value = readArg(input, key);
	return typeof value === 'boolean' ? value : undefined;
}
