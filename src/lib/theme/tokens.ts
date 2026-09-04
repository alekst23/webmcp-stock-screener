// The single source of truth for every colour and scale in the interface.
// This is the only module in src/ allowed to contain a colour literal --
// paletteGuard.ts enforces that. Components refer to roles through the CSS
// custom properties themeCss() emits, never to values directly.
//
// Roles are named for what they mean, not what they look like, so a palette
// change never turns a name into a lie.

export type SemanticRole =
	// Grounds
	| 'bgApp'
	| 'bgPanel'
	| 'bgElevated'
	| 'bgHover'
	// Lines
	| 'border'
	| 'borderStrong'
	| 'separator'
	| 'gridLine'
	// Text
	| 'textPrimary'
	| 'textSecondary'
	| 'textMuted'
	| 'textOnAccent'
	// Interactive
	| 'accent'
	| 'accentHover'
	| 'focusRing'
	// Status -- synthetic/degraded/error are distinct roles, not aliases,
	// because the spec requires no two of them ever render the same colour.
	| 'warning'
	| 'synthetic'
	| 'syntheticBg'
	| 'degraded'
	| 'degradedBg'
	| 'error'
	| 'errorBg'
	// Actors in the activity log
	| 'actorHuman'
	| 'actorAgent'
	// Chart
	| 'chartLine'
	| 'chartFillFrom'
	| 'chartFillTo'
	| 'chartGrid'
	| 'chartAxis'
	| 'chartAnchor'
	| 'chartCrosshair'
	| 'chartTooltipBg'
	| 'chartTooltipText';

export interface ThemeTokens {
	colors: Record<SemanticRole, string>;
	space: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
	radius: Record<'sm' | 'md', string>;
	fontSize: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
	fontFamily: Record<'ui' | 'mono', string>;
	// Two tracking treatments, not five hand-tuned values: `label` is the
	// uppercase micro-label the interface uses everywhere for a section or
	// control name, `heading` is the much subtler widening on real headings.
	tracking: Record<'heading' | 'label', string>;
}

export const theme: ThemeTokens = {
	colors: {
		// Four grounds, each a step lighter than the last, so depth reads as
		// elevation rather than as a border count.
		bgApp: '#080b12',
		bgPanel: '#0e131d',
		bgElevated: '#141b28',
		bgHover: '#1b2433',

		// `border` and `separator` only group content and are exempt from the
		// contrast floor; `borderStrong` bounds interactive controls and so
		// clears 3:1 on every ground. `gridLine` is dimmer still -- it draws
		// the empty-grid outline, which should read as barely-there scaffolding
		// against `bgApp`, not as a visible divider like `separator`.
		border: '#202b3b',
		borderStrong: '#8293a9',
		separator: '#18202c',
		gridLine: '#192231',

		textPrimary: '#e6edf5',
		textSecondary: '#aebbcd',
		textMuted: '#93a1b5',
		// Dark rather than white: the accent is light enough that white on it
		// falls under 3:1, so the legible pairing is the inverse one.
		textOnAccent: '#06131f',

		accent: '#4c9df5',
		accentHover: '#7bb8ff',
		focusRing: '#5aa9ff',

		warning: '#e3b341',
		// Violet, amber and red respectively: three well-separated hues, so no
		// two of these states can be mistaken for one another.
		synthetic: '#c58aff',
		syntheticBg: '#241a2e',
		degraded: '#ffc14d',
		degradedBg: '#2b2211',
		error: '#ff6b6b',
		errorBg: '#2e1519',

		actorHuman: '#58a6ff',
		actorAgent: '#3fd68b',

		chartLine: '#3fd68b',
		chartFillFrom: '#3fd68b',
		chartFillTo: '#0e131d',
		// Gridlines are decorative scaffolding; they sit deliberately below the
		// contrast floor so the price line is the only thing that draws the eye.
		chartGrid: '#1e2836',
		chartAxis: '#93a1b5',
		chartAnchor: '#6c7d95',
		chartCrosshair: '#8899ad',
		chartTooltipBg: '#080b12',
		chartTooltipText: '#e6edf5'
	},
	space: {
		xs: '0.25rem',
		sm: '0.5rem',
		md: '0.75rem',
		lg: '1.25rem',
		xl: '2rem'
	},
	radius: {
		sm: '3px',
		md: '5px'
	},
	fontSize: {
		xs: '0.6875rem',
		sm: '0.75rem',
		md: '0.8125rem',
		lg: '1rem',
		xl: '1.25rem'
	},
	fontFamily: {
		ui: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
		mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
	},
	tracking: {
		heading: '0.01em',
		label: '0.08em'
	}
};

// The custom-property name for a role. Shared by the emitter and any
// consumer so the two can never disagree on a spelling.
export function cssVarName(role: SemanticRole): string {
	return `--${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function declarations(t: ThemeTokens): string[] {
	const lines: string[] = [];
	for (const role of Object.keys(t.colors) as SemanticRole[]) {
		lines.push(`${cssVarName(role)}: ${t.colors[role]};`);
	}
	for (const [key, value] of Object.entries(t.space)) {
		lines.push(`--space-${key}: ${value};`);
	}
	for (const [key, value] of Object.entries(t.radius)) {
		lines.push(`--radius-${key}: ${value};`);
	}
	for (const [key, value] of Object.entries(t.fontSize)) {
		lines.push(`--font-size-${key}: ${value};`);
	}
	for (const [key, value] of Object.entries(t.fontFamily)) {
		lines.push(`--font-${key}: ${value};`);
	}
	for (const [key, value] of Object.entries(t.tracking)) {
		lines.push(`--tracking-${key}: ${value};`);
	}
	return lines;
}

// Renders the tokens as a `:root { ... }` block for injection into <head>.
// Emitting from the same constants the tests measure is what keeps the
// asserted palette and the painted palette from drifting apart.
export function themeCss(t: ThemeTokens = theme): string {
	return `:root {\n\t${declarations(t).join('\n\t')}\n}`;
}
