import { describe, expect, it } from 'vitest';
import { findColourLiterals } from './paletteGuard';

describe('colour literal detection', () => {
	it('test_finds_a_hex_literal_with_its_line_number', () => {
		expect.fail('not implemented');
	});

	it('test_finds_rgb_and_hsl_function_literals', () => {
		expect.fail('not implemented');
	});

	it('test_ignores_var_references_to_theme_tokens', () => {
		expect.fail('not implemented');
	});

	it('test_ignores_non_colour_hashes_such_as_url_fragments', () => {
		expect.fail('not implemented');
	});

	it('test_returns_empty_for_a_fully_tokenised_source', () => {
		expect.fail('not implemented');
	});
});

// The guard that actually holds the line: walks every component and fails
// on any colour named outside tokens.ts. This test is red on today's main
// (roughly forty literals across ten style blocks) and is the evidence the
// conversion is complete rather than partial.
describe('no component names a colour directly', () => {
	it('test_no_raw_colour_literals_outside_the_token_module', () => {
		expect.fail('not implemented');
	});
});

// Two spec invariants with no other home. Both are structural guarantees a
// restyle is uniquely likely to disturb, and neither is covered by any
// existing test -- see technical.md, "Testing", for why a source-order
// assertion was chosen over adding a component-mounting dependency.
describe('restyle-sensitive page invariants', () => {
	it('test_activity_feed_renders_after_the_focus_chart', () => {
		expect.fail('not implemented');
	});

	it('test_agent_context_comment_is_still_emitted', () => {
		expect.fail('not implemented');
	});

	it('test_both_tool_counts_are_still_rendered_in_the_top_bar', () => {
		expect.fail('not implemented');
	});
});

void findColourLiterals;
