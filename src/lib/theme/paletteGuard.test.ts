import { describe, expect, it } from 'vitest';
import { findColourLiterals, SOURCE_GLOB } from './paletteGuard';

// Vite's glob import rather than a filesystem walk: it needs no node typings
// (the project has none) and it resolves the same set of files SOURCE_GLOB
// names, so the guard cannot silently walk nothing.
const SOURCES = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const PAGE = SOURCES['/src/routes/+page.svelte'] ?? '';
const SHELL = SOURCES['/src/lib/shell/AppShell.svelte'] ?? '';

describe('colour literal detection', () => {
	it('test_finds_a_hex_literal_with_its_line_number', () => {
		const source = ['.a {', '\tcolor: #ff8800;', '}'].join('\n');
		expect(findColourLiterals(source, 'a.svelte')).toEqual([
			{ file: 'a.svelte', line: 2, literal: '#ff8800' }
		]);
		const shorthand = findColourLiterals('color: #fff;', 'b.svelte');
		expect(shorthand, 'shorthand hex is a colour literal too').toEqual([
			{ file: 'b.svelte', line: 1, literal: '#fff' }
		]);
	});

	it('test_finds_rgb_and_hsl_function_literals', () => {
		const source = [
			'.a { color: rgb(255, 0, 0); }',
			'.b { color: rgba(255, 0, 0, 0.5); }',
			'.c { color: hsl(210 50% 40%); }',
			'.d { color: hsla(210, 50%, 40%, 0.2); }'
		].join('\n');
		const found = findColourLiterals(source, 'c.svelte');
		expect(
			found.map((f) => f.literal),
			'every functional colour form'
		).toEqual([
			'rgb(255, 0, 0)',
			'rgba(255, 0, 0, 0.5)',
			'hsl(210 50% 40%)',
			'hsla(210, 50%, 40%, 0.2)'
		]);
		expect(found.map((f) => f.line)).toEqual([1, 2, 3, 4]);
	});

	it('test_ignores_var_references_to_theme_tokens', () => {
		const source = [
			'.a {',
			'\tcolor: var(--text-primary);',
			'\tbackground: var(--bg-panel);',
			'\tborder: 1px solid var(--border);',
			'}'
		].join('\n');
		expect(findColourLiterals(source, 'd.svelte'), 'var() references name no colour').toEqual([]);
		// A fallback value inside var() *is* a named colour and must be caught.
		const withFallback = findColourLiterals('color: var(--accent, #4c9df5);', 'e.svelte');
		expect(withFallback.map((f) => f.literal)).toEqual(['#4c9df5']);
	});

	it('test_ignores_non_colour_hashes_such_as_url_fragments', () => {
		const source = [
			'<a href="#main">Skip</a>',
			'<path fill="url(#price-chart-fill-detail)" />',
			'<circle fill="url(#face)" />',
			'{#each items as item (item.id)}',
			'{#if ready}<b>ok</b>{/if}',
			'<a href="#beef">anchor spelled in hex</a>'
		].join('\n');
		expect(
			findColourLiterals(source, 'f.svelte'),
			'fragments and block tags are not colours'
		).toEqual([]);
	});

	it('test_returns_empty_for_a_fully_tokenised_source', () => {
		expect(SHELL, 'AppShell.svelte was not resolved').toContain('app-shell');
		expect(findColourLiterals(SHELL, 'AppShell.svelte'), 'the shell names no colour').toEqual([]);
	});
});

// The guard that actually holds the line: walks every component and fails
// on any colour named outside tokens.ts. This test is red on today's main
// (roughly forty literals across ten style blocks) and is the evidence the
// conversion is complete rather than partial.
describe('no component names a colour directly', () => {
	it('test_no_raw_colour_literals_outside_the_token_module', () => {
		const files = Object.entries(SOURCES);
		expect(files.length, `no sources matched ${SOURCE_GLOB}`).toBeGreaterThan(0);
		const offenders = files.flatMap(([file, source]) =>
			findColourLiterals(source, file.replace(/^\//, ''))
		);
		expect(
			offenders,
			`colours must be named in tokens.ts, not at the point of use:\n${offenders
				.map((o) => `  ${o.file}:${o.line} ${o.literal}`)
				.join('\n')}`
		).toEqual([]);
	});
});

// Two spec invariants with no other home. Both are structural guarantees a
// restyle is uniquely likely to disturb, and neither is covered by any
// existing test -- see technical.md, "Testing", for why a source-order
// assertion was chosen over adding a component-mounting dependency.
describe('restyle-sensitive page invariants', () => {
	const page = PAGE;

	it('test_activity_feed_renders_after_the_focus_chart', () => {
		const focus = page.indexOf('<FocusChart');
		const feed = page.indexOf('<ActivityFeed');
		expect(focus, 'FocusChart is no longer rendered').toBeGreaterThan(-1);
		expect(feed, 'ActivityFeed is no longer rendered').toBeGreaterThan(-1);
		expect(feed, 'the activity log must stay below the focus chart').toBeGreaterThan(focus);
		expect(page.indexOf('<GridPanel'), 'GridPanel is no longer rendered').toBeGreaterThan(-1);
		expect(feed, 'the activity log must stay below the panels').toBeGreaterThan(
			page.indexOf('<GridPanel')
		);
	});

	it('test_agent_context_comment_is_still_emitted', () => {
		// An agent reads this out of the page's HTML source, so it has to be an
		// actual emitted comment -- not a rendered element, and not dropped.
		expect(page, 'the agent context comment must still be emitted as HTML').toMatch(
			/\{@html\s+`<!--\s*\$\{formatAgentToolsContext\(/
		);
		expect(page, 'formatAgentToolsContext must still be imported').toContain(
			'formatAgentToolsContext'
		);
	});

	it('test_both_tool_counts_are_still_rendered_in_the_top_bar', () => {
		const start = page.indexOf('{#snippet topBar()}');
		expect(start, 'the page no longer composes through AppShell topBar').toBeGreaterThan(-1);
		const end = page.indexOf('{/snippet}', start);
		expect(end, 'the topBar snippet is unterminated').toBeGreaterThan(start);
		const topBar = page.slice(start, end);
		expect(topBar, 'the defined-tool count left the top bar').toContain('formatDefinedStatus(');
		expect(topBar, 'the callable-tool count left the top bar').toContain('formatAvailableStatus(');
	});
});
