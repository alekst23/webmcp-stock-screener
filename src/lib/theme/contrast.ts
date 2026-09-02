// WCAG 2.x contrast maths. Kept as pure functions over hex strings so the
// palette's legibility is a test result rather than a judgement call --
// see docs/design/terminal-ui-theme/spec.md, "Legible by measurement".

// Invalid input throws rather than returning a plausible-looking number: a
// malformed token should fail the test that reads it, not quietly pass.
export function relativeLuminance(_hex: string): number {
	throw new Error('not implemented');
}

// Order-independent, range 1-21.
export function contrastRatio(_a: string, _b: string): number {
	throw new Error('not implemented');
}

// Body text floor.
export function meetsAA(_fg: string, _bg: string): boolean {
	throw new Error('not implemented');
}

// Large text and meaningful non-text floor.
export function meetsAALarge(_fg: string, _bg: string): boolean {
	throw new Error('not implemented');
}
