import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA, meetsAALarge } from './contrast';
import { cssVarName, theme, themeCss, type SemanticRole } from './tokens';

const HEX = /^#[0-9a-f]{6}$/;

const ROLES = Object.keys(theme.colors) as SemanticRole[];

// Every ground a body-level string is actually painted on.
const GROUNDS: SemanticRole[] = ['bgApp', 'bgPanel', 'bgElevated', 'bgHover'];
const BODY_TEXT: SemanticRole[] = ['textPrimary', 'textSecondary', 'textMuted'];

// Colours that carry meaning without text: control boundaries, the focus
// indicator, and the state indicators. `border`, `separator` and `chartGrid`
// are deliberately absent -- the spec exempts purely decorative rules.
const MEANINGFUL_NON_TEXT: SemanticRole[] = [
	'borderStrong',
	'focusRing',
	'accent',
	'positive',
	'negative',
	'warning',
	'chartLine',
	'chartAnchor'
];

const STATUS_PAIRS: [SemanticRole, SemanticRole][] = [
	['synthetic', 'syntheticBg'],
	['degraded', 'degradedBg'],
	['error', 'errorBg']
];

// Distance in sRGB, out of a 441 maximum. Contrast ratio cannot answer "are
// these two the same colour" -- amber and red can share a luminance while
// being obviously different -- so distinguishability is measured as
// separation, not as contrast.
function colourDistance(a: string, b: string): number {
	const parse = (hex: string) =>
		[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
	const [ar, ag, ab] = parse(a);
	const [br, bg, bb] = parse(b);
	return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

const DISTINCT_ENOUGH = 60;

// The palette is only trustworthy if every role actually resolves and every
// pairing the interface actually uses clears its floor. These tests are the
// reason the palette can be called legible.
describe('theme tokens', () => {
	it('test_every_semantic_role_has_a_value', () => {
		// The union is compile-time only, so the runtime check is that the
		// declared roles and the populated keys are the same set.
		const declared: SemanticRole[] = [
			'bgApp',
			'bgPanel',
			'bgElevated',
			'bgHover',
			'border',
			'borderStrong',
			'separator',
			'textPrimary',
			'textSecondary',
			'textMuted',
			'textOnAccent',
			'accent',
			'accentHover',
			'focusRing',
			'positive',
			'negative',
			'warning',
			'synthetic',
			'syntheticBg',
			'degraded',
			'degradedBg',
			'error',
			'errorBg',
			'actorHuman',
			'actorAgent',
			'chartLine',
			'chartFillFrom',
			'chartFillTo',
			'chartGrid',
			'chartAxis',
			'chartAnchor',
			'chartCrosshair',
			'chartTooltipBg',
			'chartTooltipText'
		];
		expect([...ROLES].sort(), 'populated roles vs declared roles').toEqual([...declared].sort());
		for (const role of declared) {
			const value = theme.colors[role];
			expect(value, `${role} has no value`).toBeTruthy();
		}
	});

	it('test_every_colour_is_a_valid_hex', () => {
		for (const role of ROLES) {
			expect(theme.colors[role], `${role} is not a 6-digit lowercase hex`).toMatch(HEX);
		}
	});

	it('test_space_radius_and_font_scales_are_populated', () => {
		expect(Object.keys(theme.space).sort()).toEqual(['lg', 'md', 'sm', 'xl', 'xs']);
		expect(Object.keys(theme.radius).sort()).toEqual(['lg', 'md', 'sm']);
		expect(Object.keys(theme.fontSize).sort()).toEqual(['lg', 'md', 'sm', 'xl', 'xs']);
		expect(Object.keys(theme.fontFamily).sort()).toEqual(['mono', 'ui']);
		const scales = {
			...theme.space,
			...theme.radius,
			...theme.fontSize,
			...theme.fontFamily
		} as Record<string, string>;
		for (const [key, value] of Object.entries(scales)) {
			expect(value, `scale entry ${key} is empty`).toBeTruthy();
			expect(typeof value, `scale entry ${key} is not a string`).toBe('string');
		}
		// A scale is only a scale if its steps differ.
		expect(new Set(Object.values(theme.space)).size, 'space steps are not distinct').toBe(5);
		expect(new Set(Object.values(theme.fontSize)).size, 'font sizes are not distinct').toBe(5);
	});
});

describe('theme contrast compliance', () => {
	it('test_body_text_roles_meet_aa_on_their_grounds', () => {
		for (const text of BODY_TEXT) {
			for (const ground of GROUNDS) {
				const ratio = contrastRatio(theme.colors[text], theme.colors[ground]);
				expect(
					meetsAA(theme.colors[text], theme.colors[ground]),
					`${text} on ${ground} is ${ratio.toFixed(2)}:1`
				).toBe(true);
			}
		}
	});

	it('test_accent_and_market_colours_meet_aa_on_panel', () => {
		const panel = theme.colors.bgPanel;
		for (const role of ['accent', 'accentHover', 'positive', 'negative'] as SemanticRole[]) {
			const ratio = contrastRatio(theme.colors[role], panel);
			expect(
				meetsAA(theme.colors[role], panel),
				`${role} on bgPanel is ${ratio.toFixed(2)}:1`
			).toBe(true);
		}
	});

	it('test_meaningful_non_text_roles_meet_3_to_1', () => {
		for (const role of MEANINGFUL_NON_TEXT) {
			for (const ground of GROUNDS) {
				const ratio = contrastRatio(theme.colors[role], theme.colors[ground]);
				expect(
					meetsAALarge(theme.colors[role], theme.colors[ground]),
					`${role} on ${ground} is ${ratio.toFixed(2)}:1`
				).toBe(true);
			}
		}
	});

	it('test_text_on_accent_is_legible_against_accent', () => {
		for (const accent of ['accent', 'accentHover'] as SemanticRole[]) {
			const ratio = contrastRatio(theme.colors.textOnAccent, theme.colors[accent]);
			expect(
				meetsAA(theme.colors.textOnAccent, theme.colors[accent]),
				`textOnAccent on ${accent} is ${ratio.toFixed(2)}:1`
			).toBe(true);
		}
	});
});

// The spec requires these three states never be confusable with each other
// or with ordinary body text -- the exact guarantee the old light-theme
// backgrounds (#fdf8e6, #fdf0f0) provided and that a dark ground would
// otherwise quietly destroy.
describe('status states stay distinguishable', () => {
	it('test_synthetic_degraded_and_error_are_pairwise_distinct', () => {
		const pairs: [SemanticRole, SemanticRole][] = [
			['synthetic', 'degraded'],
			['synthetic', 'error'],
			['degraded', 'error']
		];
		for (const [a, b] of pairs) {
			expect(theme.colors[a], `${a} and ${b} are the same colour`).not.toBe(theme.colors[b]);
			const distance = colourDistance(theme.colors[a], theme.colors[b]);
			expect(distance, `${a} and ${b} are only ${distance.toFixed(0)} apart`).toBeGreaterThan(
				DISTINCT_ENOUGH
			);
		}
		// Their grounds must not collapse into one another either.
		const bgs: [SemanticRole, SemanticRole][] = [
			['syntheticBg', 'degradedBg'],
			['syntheticBg', 'errorBg'],
			['degradedBg', 'errorBg']
		];
		for (const [a, b] of bgs) {
			expect(theme.colors[a], `${a} and ${b} are the same colour`).not.toBe(theme.colors[b]);
		}
	});

	it('test_each_status_role_is_distinct_from_body_text', () => {
		for (const [role] of STATUS_PAIRS) {
			for (const text of BODY_TEXT) {
				const distance = colourDistance(theme.colors[role], theme.colors[text]);
				expect(
					distance,
					`${role} and ${text} are only ${distance.toFixed(0)} apart`
				).toBeGreaterThan(DISTINCT_ENOUGH);
			}
		}
	});

	it('test_each_status_role_meets_aa_on_its_own_background', () => {
		for (const [fg, bg] of STATUS_PAIRS) {
			const ratio = contrastRatio(theme.colors[fg], theme.colors[bg]);
			expect(
				meetsAA(theme.colors[fg], theme.colors[bg]),
				`${fg} on ${bg} is ${ratio.toFixed(2)}:1`
			).toBe(true);
			// The state's ground must also read as a distinct patch against the
			// surface it sits on, or the state is invisible when its text is short.
			expect(meetsAALarge(theme.colors[fg], theme.colors.bgPanel), `${fg} on bgPanel`).toBe(true);
		}
	});

	it('test_human_and_agent_actor_colours_are_distinguishable', () => {
		const distance = colourDistance(theme.colors.actorHuman, theme.colors.actorAgent);
		expect(theme.colors.actorHuman).not.toBe(theme.colors.actorAgent);
		expect(distance, `actor colours are only ${distance.toFixed(0)} apart`).toBeGreaterThan(
			DISTINCT_ENOUGH
		);
		for (const role of ['actorHuman', 'actorAgent'] as SemanticRole[]) {
			expect(meetsAA(theme.colors[role], theme.colors.bgElevated), `${role} on bgElevated`).toBe(
				true
			);
		}
	});

	it('test_positive_and_negative_are_distinguishable_from_each_other', () => {
		const distance = colourDistance(theme.colors.positive, theme.colors.negative);
		expect(theme.colors.positive).not.toBe(theme.colors.negative);
		expect(distance, `positive and negative are only ${distance.toFixed(0)} apart`).toBeGreaterThan(
			DISTINCT_ENOUGH
		);
	});
});

describe('themeCss emission', () => {
	it('test_emits_a_root_block_declaring_every_role', () => {
		const css = themeCss();
		expect(css.startsWith(':root {'), 'css does not open with a :root block').toBe(true);
		expect(css.trimEnd().endsWith('}'), 'css does not close its block').toBe(true);
		for (const role of ROLES) {
			expect(css, `${role} is not declared`).toContain(`${cssVarName(role)}:`);
		}
	});

	it('test_emitted_values_match_the_token_constants', () => {
		const css = themeCss();
		for (const role of ROLES) {
			expect(css, `${cssVarName(role)} does not carry its token value`).toContain(
				`${cssVarName(role)}: ${theme.colors[role]};`
			);
		}
		// The scales ride along, so a component never has to hardcode a step.
		expect(css).toContain(`--space-md: ${theme.space.md};`);
		expect(css).toContain(`--radius-md: ${theme.radius.md};`);
		expect(css).toContain(`--font-size-sm: ${theme.fontSize.sm};`);
		expect(css).toContain(`--font-mono: ${theme.fontFamily.mono};`);
	});

	it('test_css_var_name_is_stable_and_kebab_cased', () => {
		expect(cssVarName('bgApp')).toBe('--bg-app');
		expect(cssVarName('textPrimary')).toBe('--text-primary');
		expect(cssVarName('chartFillFrom')).toBe('--chart-fill-from');
		expect(cssVarName('accent')).toBe('--accent');
		const names = ROLES.map(cssVarName);
		for (const name of names) {
			expect(name, `${name} is not a kebab-cased custom property`).toMatch(
				/^--[a-z0-9]+(-[a-z0-9]+)*$/
			);
		}
		expect(new Set(names).size, 'two roles share a custom-property name').toBe(names.length);
	});
});

export type { SemanticRole };
