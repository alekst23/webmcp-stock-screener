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
	// Text
	| 'textPrimary'
	| 'textSecondary'
	| 'textMuted'
	| 'textOnAccent'
	// Interactive
	| 'accent'
	| 'accentHover'
	| 'focusRing'
	// Market direction
	| 'positive'
	| 'negative'
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
	radius: Record<'sm' | 'md' | 'lg', string>;
	fontSize: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
	fontFamily: Record<'ui' | 'mono', string>;
}

export const theme: ThemeTokens = null as unknown as ThemeTokens;

// The custom-property name for a role. Shared by the emitter and any
// consumer so the two can never disagree on a spelling.
export function cssVarName(_role: SemanticRole): string {
	throw new Error('not implemented');
}

// Renders the tokens as a `:root { ... }` block for injection into <head>.
// Emitting from the same constants the tests measure is what keeps the
// asserted palette and the painted palette from drifting apart.
export function themeCss(_t?: ThemeTokens): string {
	throw new Error('not implemented');
}
