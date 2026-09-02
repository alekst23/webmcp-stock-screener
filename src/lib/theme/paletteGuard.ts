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

// Every hex, rgb()/rgba(), or hsl()/hsla() literal in one file's source.
export function findColourLiterals(_source: string, _file: string): ColourLiteral[] {
	throw new Error('not implemented');
}
