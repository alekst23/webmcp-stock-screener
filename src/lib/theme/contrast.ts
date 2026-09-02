// WCAG 2.x contrast maths. Kept as pure functions over hex strings so the
// palette's legibility is a test result rather than a judgement call --
// see docs/design/terminal-ui-theme/spec.md, "Legible by measurement".

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const AA_RATIO = 4.5;
const AA_LARGE_RATIO = 3;

function channels(hex: string): [number, number, number] {
	if (typeof hex !== 'string' || !HEX_PATTERN.test(hex.trim())) {
		throw new Error(`Not a hex colour: ${String(hex)}`);
	}
	const digits = hex.trim().slice(1);
	const expanded =
		digits.length === 3
			? digits
					.split('')
					.map((d) => d + d)
					.join('')
			: digits;
	return [
		parseInt(expanded.slice(0, 2), 16),
		parseInt(expanded.slice(2, 4), 16),
		parseInt(expanded.slice(4, 6), 16)
	];
}

// The sRGB companding curve from WCAG 2.x; the 0.03928 threshold and the
// 2.4 exponent are the specified constants, not tunable choices.
function linearize(channel: number): number {
	const c = channel / 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Invalid input throws rather than returning a plausible-looking number: a
// malformed token should fail the test that reads it, not quietly pass.
export function relativeLuminance(hex: string): number {
	const [r, g, b] = channels(hex);
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

// Order-independent, range 1-21.
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const lighter = Math.max(la, lb);
	const darker = Math.min(la, lb);
	return (lighter + 0.05) / (darker + 0.05);
}

// Body text floor.
export function meetsAA(fg: string, bg: string): boolean {
	return contrastRatio(fg, bg) >= AA_RATIO;
}

// Large text and meaningful non-text floor.
export function meetsAALarge(fg: string, bg: string): boolean {
	return contrastRatio(fg, bg) >= AA_LARGE_RATIO;
}
