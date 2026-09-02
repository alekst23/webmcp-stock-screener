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

// A `#` run that is the right length for a colour and is not the prefix of a
// longer identifier -- `{#each}` and `#section-1` are excluded by the length
// and trailing-character rules rather than by a keyword list.
const HEX = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g;

// Every colour function CSS accepts, not just the two the palette happens to
// use today: a hurried edit reaches for whichever one it knows.
const FUNCTIONAL = /(?<![-\w])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\([^)]*\)/gi;

// The CSS named colours. `background: white` is the likeliest form of
// erosion by some distance and the pattern above cannot see it.
const NAMED_COLOURS = (
	'transparent aliceblue antiquewhite aqua aquamarine azure beige bisque black ' +
	'blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate ' +
	'coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod ' +
	'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange ' +
	'darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
	'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
	'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold ' +
	'goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory ' +
	'khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral ' +
	'lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink ' +
	'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey ' +
	'lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
	'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
	'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
	'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered ' +
	'orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff ' +
	'peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
	'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue ' +
	'slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise ' +
	'violet wheat white whitesmoke yellow yellowgreen'
).split(' ');

// The surrounding `-` and word characters are what keep `silver-badge`, a
// `--sea-green` custom property, and the word "red" in prose from reading as
// colour literals.
const NAMED = new RegExp(`(?<![-\\w])(?:${NAMED_COLOURS.join('|')})(?![-\\w])`, 'gi');

const HEX_LENGTHS = new Set([3, 4, 6, 8]);

// An SVG `url(#gradient-id)` or an in-page `href="#anchor"` is a reference,
// not a colour, even when the identifier happens to be spelled in hex.
const REFERENCE_PREFIX = /(?:url\(|href\s*=\s*["'{]?|xlink:href\s*=\s*["'{]?)$/i;

// SVG paints colour through presentation attributes as well as declarations,
// so a bare name in one of these is a colour with no `:` in front of it.
const COLOUR_ATTRIBUTE =
	/(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*["'{]?$/i;

// Comment bodies are replaced with spaces rather than removed so every index
// into the masked source still points at the same character of the original.
function maskComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<!:)\/\/[^\n]*/g, (comment) =>
		comment.replace(/[^\n]/g, ' ')
	);
}

function lineOf(source: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i += 1) {
		if (source[i] === '\n') {
			line += 1;
		}
	}
	return line;
}

// True when the word at `index` sits after a `:` in the declaration it
// belongs to -- the difference between `background: white` and the `white` in
// `white-space` or in a class name.
function isDeclarationValue(source: string, index: number): boolean {
	let start = -1;
	for (const boundary of [';', '{', '}', '"', "'", '\n', '=', '>']) {
		start = Math.max(start, source.lastIndexOf(boundary, index - 1));
	}
	return source.slice(start + 1, index).includes(':');
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

function collectNamed(source: string, file: string): ColourLiteral[] {
	const masked = maskComments(source);
	const found: ColourLiteral[] = [];
	for (const match of masked.matchAll(NAMED)) {
		const index = match.index ?? 0;
		const before = masked.slice(Math.max(0, index - 24), index);
		if (!isDeclarationValue(masked, index) && !COLOUR_ATTRIBUTE.test(before)) {
			continue;
		}
		found.push({ file, line: lineOf(masked, index), literal: match[0] });
	}
	return found;
}

// Reported with file and line because the failure a developer gets is a list
// of places to fix, not a yes/no.
export function findColourLiterals(source: string, file: string): ColourLiteral[] {
	return [
		...collect(source, file, HEX),
		...collect(source, file, FUNCTIONAL),
		...collectNamed(source, file)
	].sort((a, b) => a.line - b.line);
}
