import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA, meetsAALarge, relativeLuminance } from './contrast';

// Pins the maths itself against values that are not negotiable, so a bug
// here cannot silently certify an illegible palette as compliant.
describe('contrast maths', () => {
	it('test_contrast_ratio_of_black_on_white_is_21', () => {
		expect.fail('not implemented');
	});

	it('test_contrast_ratio_of_a_colour_with_itself_is_1', () => {
		expect.fail('not implemented');
	});

	it('test_contrast_ratio_is_order_independent', () => {
		expect.fail('not implemented');
	});

	it('test_relative_luminance_of_black_is_0_and_white_is_1', () => {
		expect.fail('not implemented');
	});

	it('test_shorthand_and_longhand_hex_agree', () => {
		expect.fail('not implemented');
	});

	it('test_malformed_hex_throws_rather_than_returning_a_number', () => {
		expect.fail('not implemented');
	});

	it('test_meets_aa_is_true_at_4_5_and_false_below', () => {
		expect.fail('not implemented');
	});

	it('test_meets_aa_large_is_true_at_3_and_false_below', () => {
		expect.fail('not implemented');
	});
});

// Silence the unused-import error while the stubs are red; every one of
// these is exercised by the assertions above once implemented.
void [relativeLuminance, contrastRatio, meetsAA, meetsAALarge];
