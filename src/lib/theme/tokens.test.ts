import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA, meetsAALarge } from './contrast';
import { cssVarName, theme, themeCss, type SemanticRole } from './tokens';

// The palette is only trustworthy if every role actually resolves and every
// pairing the interface actually uses clears its floor. These tests are the
// reason the palette can be called legible.
describe('theme tokens', () => {
	it('test_every_semantic_role_has_a_value', () => {
		expect.fail('not implemented');
	});

	it('test_every_colour_is_a_valid_hex', () => {
		expect.fail('not implemented');
	});

	it('test_space_radius_and_font_scales_are_populated', () => {
		expect.fail('not implemented');
	});
});

describe('theme contrast compliance', () => {
	it('test_body_text_roles_meet_aa_on_their_grounds', () => {
		expect.fail('not implemented');
	});

	it('test_accent_and_market_colours_meet_aa_on_panel', () => {
		expect.fail('not implemented');
	});

	it('test_meaningful_non_text_roles_meet_3_to_1', () => {
		expect.fail('not implemented');
	});

	it('test_text_on_accent_is_legible_against_accent', () => {
		expect.fail('not implemented');
	});
});

// The spec requires these three states never be confusable with each other
// or with ordinary body text -- the exact guarantee the old light-theme
// backgrounds (#fdf8e6, #fdf0f0) provided and that a dark ground would
// otherwise quietly destroy.
describe('status states stay distinguishable', () => {
	it('test_synthetic_degraded_and_error_are_pairwise_distinct', () => {
		expect.fail('not implemented');
	});

	it('test_each_status_role_is_distinct_from_body_text', () => {
		expect.fail('not implemented');
	});

	it('test_each_status_role_meets_aa_on_its_own_background', () => {
		expect.fail('not implemented');
	});

	it('test_human_and_agent_actor_colours_are_distinguishable', () => {
		expect.fail('not implemented');
	});

	it('test_positive_and_negative_are_distinguishable_from_each_other', () => {
		expect.fail('not implemented');
	});
});

describe('themeCss emission', () => {
	it('test_emits_a_root_block_declaring_every_role', () => {
		expect.fail('not implemented');
	});

	it('test_emitted_values_match_the_token_constants', () => {
		expect.fail('not implemented');
	});

	it('test_css_var_name_is_stable_and_kebab_cased', () => {
		expect.fail('not implemented');
	});
});

void [theme, themeCss, cssVarName, contrastRatio, meetsAA, meetsAALarge];
export type { SemanticRole };
