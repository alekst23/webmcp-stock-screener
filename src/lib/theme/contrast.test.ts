import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA, meetsAALarge, relativeLuminance } from './contrast';

// Pins the maths itself against values that are not negotiable, so a bug
// here cannot silently certify an illegible palette as compliant.
describe('contrast maths', () => {
	it('test_contrast_ratio_of_black_on_white_is_21', () => {
		const ratio = contrastRatio('#000000', '#ffffff');
		expect(ratio).toBeCloseTo(21, 5);
	});

	it('test_contrast_ratio_of_a_colour_with_itself_is_1', () => {
		for (const hex of ['#000000', '#ffffff', '#4c9df5', '#0e131d']) {
			expect(contrastRatio(hex, hex), `${hex} against itself`).toBeCloseTo(1, 10);
		}
	});

	it('test_contrast_ratio_is_order_independent', () => {
		const pairs: [string, string][] = [
			['#000000', '#ffffff'],
			['#4c9df5', '#0e131d'],
			['#ff6b6b', '#2e1519']
		];
		for (const [a, b] of pairs) {
			expect(contrastRatio(a, b), `${a} vs ${b}`).toBeCloseTo(contrastRatio(b, a), 10);
		}
	});

	it('test_relative_luminance_of_black_is_0_and_white_is_1', () => {
		expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
		expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
	});

	it('test_relative_luminance_uses_the_wcag_channel_coefficients', () => {
		// Every other fixture here is greyscale, where R=G=B makes any
		// permutation -- or a flat channel average -- indistinguishable from
		// the real coefficients. A pure primary at full intensity linearizes
		// to 1, so its luminance IS its channel's coefficient.
		expect(relativeLuminance('#ff0000'), 'red carries the R coefficient').toBeCloseTo(0.2126, 6);
		expect(relativeLuminance('#00ff00'), 'green carries the G coefficient').toBeCloseTo(0.7152, 6);
		expect(relativeLuminance('#0000ff'), 'blue carries the B coefficient').toBeCloseTo(0.0722, 6);
		// Green is the channel the eye weights most; a wrong ordering would
		// certify an illegible palette as compliant.
		expect(
			relativeLuminance('#00ff00'),
			'green must outweigh red, and red must outweigh blue'
		).toBeGreaterThan(relativeLuminance('#ff0000'));
		expect(relativeLuminance('#ff0000')).toBeGreaterThan(relativeLuminance('#0000ff'));
	});

	it('test_shorthand_and_longhand_hex_agree', () => {
		const cases: [string, string][] = [
			['#fff', '#ffffff'],
			['#000', '#000000'],
			['#4af', '#44aaff']
		];
		for (const [short, long] of cases) {
			expect(relativeLuminance(short), `${short} vs ${long}`).toBeCloseTo(
				relativeLuminance(long),
				10
			);
		}
	});

	it('test_malformed_hex_throws_rather_than_returning_a_number', () => {
		const malformed = ['', '#', 'ffffff', '#gggggg', '#12345', 'rgb(0,0,0)', '#ffffffff'];
		for (const value of malformed) {
			expect(() => relativeLuminance(value), `relativeLuminance(${value})`).toThrow();
			expect(() => contrastRatio(value, '#ffffff'), `contrastRatio(${value})`).toThrow();
		}
	});

	it('test_meets_aa_is_true_at_4_5_and_false_below', () => {
		// #767676 on white is 4.54:1; #777777 is 4.48:1 -- the tightest pair
		// that straddles the threshold in 8-bit grey.
		expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
		expect(meetsAA('#767676', '#ffffff'), 'grey just above the AA floor').toBe(true);
		expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
		expect(meetsAA('#777777', '#ffffff'), 'grey just below the AA floor').toBe(false);
	});

	it('test_meets_aa_large_is_true_at_3_and_false_below', () => {
		expect(contrastRatio('#949494', '#ffffff')).toBeGreaterThanOrEqual(3);
		expect(meetsAALarge('#949494', '#ffffff'), 'grey just above the 3:1 floor').toBe(true);
		expect(contrastRatio('#959595', '#ffffff')).toBeLessThan(3);
		expect(meetsAALarge('#959595', '#ffffff'), 'grey just below the 3:1 floor').toBe(false);
		// The large-text floor is genuinely looser than the body-text floor.
		expect(meetsAA('#949494', '#ffffff'), 'the same grey against the AA floor').toBe(false);
	});
});
