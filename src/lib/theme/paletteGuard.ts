// Keeps the token layer from eroding: once colours live in tokens.ts, the
// only thing stopping the next "just one more grey" from being hardcoded
// into a component is a check that fails when it is.
//
// Pure over a source string (the caller supplies the file walk), matching
// snapshotGuard.ts's convention of extracting a checkable rule into a plain
// function so it can be unit-tested without mounting a component.

export interface ColourLiteral {
	file: string;
	line: number;
	literal: string;
}

// Component sources the guard walks. tokens.ts is the deliberate exception
// and is never passed to findColourLiterals.
export const SOURCE_GLOB = 'src/**/*.svelte';

// A `#` run that is the right length for a colour and is not the prefix of a
// longer identifier -- `{#each}` and `#section-1` are excluded by the length
// and trailing-character rules rather than by a keyword list.
const HEX = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g;
const FUNCTIONAL = /\b(?:rgba?|hsla?)\([^)]*\)/gi;

const HEX_LENGTHS = new Set([3, 4, 6, 8]);

// An SVG `url(#gradient-id)` or an in-page `href="#anchor"` is a reference,
// not a colour, even when the identifier happens to be spelled in hex.
const REFERENCE_PREFIX = /(?:url\(|href\s*=\s*["'{]?|xlink:href\s*=\s*["'{]?)$/i;

function lineOf(source: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i += 1) {
		if (source[i] === '\n') {
			line += 1;
		}
	}
	return line;
}

function collect(source: string, file: string, pattern: RegExp): ColourLiteral[] {
	const found: ColourLiteral[] = [];
	for (const match of source.matchAll(pattern)) {
		const index = match.index ?? 0;
		const literal = match[0];
		if (literal.startsWith('#')) {
			if (!HEX_LENGTHS.has(literal.length - 1)) {
				continue;
			}
			if (REFERENCE_PREFIX.test(source.slice(Math.max(0, index - 16), index))) {
				continue;
			}
		}
		found.push({ file, line: lineOf(source, index), literal });
	}
	return found;
}

// Every hex, rgb()/rgba(), or hsl()/hsla() literal in one file's source.
export function findColourLiterals(source: string, file: string): ColourLiteral[] {
	return [...collect(source, file, HEX), ...collect(source, file, FUNCTIONAL)].sort(
		(a, b) => a.line - b.line
	);
}
