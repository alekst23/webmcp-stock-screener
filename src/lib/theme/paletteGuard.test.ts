import { describe, expect, it } from 'vitest';
import { findColourLiterals } from './paletteGuard';
import { theme } from './tokens';

// Vite's glob import rather than a filesystem walk: it needs no node typings
// (the project has none). The pattern is repeated in SOURCE_GLOB below only
// because import.meta.glob takes a literal -- keep the two spellings equal.
const SOURCES = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;
const SOURCE_GLOB = '/src/**/*.svelte';

const HTML_SOURCES = import.meta.glob('/src/*.html', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const PAGE = SOURCES['/src/routes/+page.svelte'] ?? '';
const LAYOUT = SOURCES['/src/routes/+layout.svelte'] ?? '';
const APP_HTML = HTML_SOURCES['/src/app.html'] ?? '';
// T-1015-9: the status header (agent-context comment, tool counts) moved
// out of +page.svelte and into this new, separately-composed shell.
const WORKBENCH_SHELL = SOURCES['/src/lib/panels/shell/WorkbenchShell.svelte'] ?? '';

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

	it('test_finds_the_modern_colour_functions', () => {
		// A hurried edit reaches for whichever colour function it knows, not
		// only the two the palette happens to use today.
		const source = [
			'.a { color: oklch(70% 0.1 250); }',
			'.b { color: lab(50% 20 -30); }',
			'.c { color: lch(50% 30 20); }',
			'.d { color: oklab(0.5 0.1 0.1); }',
			'.e { color: hwb(210 20% 30%); }',
			'.f { color: color(display-p3 1 0 0); }'
		].join('\n');
		expect(
			findColourLiterals(source, 'g.svelte').map((f) => f.line),
			'every modern colour function is a literal'
		).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('test_finds_css_named_colours_in_a_value', () => {
		const source = [
			'.a { background: white; }',
			'.b { border: 1px solid red; }',
			'.c { background: transparent; }',
			'<rect fill="silver" />',
			'<div style="color: rebeccapurple"></div>',
			'.d { color: var(--accent, lime); }'
		].join('\n');
		expect(
			findColourLiterals(source, 'h.svelte').map((f) => f.literal.toLowerCase()),
			'a named colour is as hardcoded as a hex'
		).toEqual(['white', 'red', 'transparent', 'silver', 'rebeccapurple', 'lime']);
	});

	it('test_ignores_colour_words_that_are_not_colours', () => {
		// The words are common enough that a guard which matched them anywhere
		// would cry wolf on prose, class names, and property names.
		const source = [
			'<p>The red line marks the anchor; silver bars are stale.</p>',
			'<span class="silver-badge">gold tier</span>',
			'.a { white-space: nowrap; }',
			'.b { color: var(--sea-green); }',
			'/* background: white was rejected -- use the token */',
			'<!-- fill="red" in a comment is not a paint -->',
			'// const orange = 1;',
			'.tan:hover { font-weight: 600; }'
		].join('\n');
		expect(findColourLiterals(source, 'i.svelte'), 'no colour is named here').toEqual([]);
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
		// T-1015-6: the legacy shell (src/lib/shell/AppShell.svelte) this test
		// exercised was deleted with no reuse -- WorkbenchShell.svelte is the
		// live shell now and is just as fully tokenised, so it stands in.
		expect(WORKBENCH_SHELL, 'WorkbenchShell.svelte was not resolved').toContain('status-bar');
		expect(
			findColourLiterals(WORKBENCH_SHELL, 'WorkbenchShell.svelte'),
			'the shell names no colour'
		).toEqual([]);
	});
});

// The guard that actually holds the line: walks every component and fails on
// any colour named outside tokens.ts, so the token layer cannot erode one
// "just one more grey" at a time.
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

// Nothing else asserts the palette is ever handed to the browser: the tokens
// can be perfect and every route still render unstyled if the one injection
// site stops emitting them.
describe('the theme reaches the document', () => {
	it('test_the_layout_injects_the_token_stylesheet_into_the_head', () => {
		expect(LAYOUT, '+layout.svelte was not resolved').toContain('<svelte:head>');
		const emitted = LAYOUT.match(/(?:const|let)\s+(\w+)\s*=[^\n]*themeCss\(/);
		expect(emitted, 'the layout no longer renders themeCss() into anything').not.toBeNull();
		const head = LAYOUT.slice(LAYOUT.indexOf('<svelte:head>'), LAYOUT.indexOf('</svelte:head>'));
		expect(head, 'the token stylesheet never reaches <svelte:head>').toContain(
			`{@html ${emitted![1]}`
		);
	});

	it('test_app_html_paints_the_token_ground_before_hydration', () => {
		// The :root block is injected by JS, so between first paint and
		// hydration this literal is the only thing painting the dark ground --
		// and it is the reason native scrollbars and controls render dark.
		expect(APP_HTML, 'src/app.html was not resolved').toContain('<html');
		expect(APP_HTML, `app.html must paint bgApp (${theme.colors.bgApp}) before JS runs`).toContain(
			theme.colors.bgApp
		);
		expect(APP_HTML, 'app.html must declare the dark colour-scheme before JS runs').toContain(
			'color-scheme: dark'
		);
	});
});

// T-1015-3: the main route no longer composes through AppShell (retired in
// the retirement inventory with no new-surface consumer -- PanelContainer's
// own `position: fixed; inset: 0` is a full-page escape hatch AppShell's
// three-region grid cannot host without a CSS trick this ticket's page
// applies locally instead, see +page.svelte's own `.panel-viewport`
// comment). The action log is a confirmed, signed-off drop for this route
// (capability-parity-matrix.md: "no replacement in progress under any
// current epic") -- T-1015-10 owns building its new-surface affordance, not
// this ticket, so there is no shell/snippet indirection left to assert here.
describe('restyle-sensitive page invariants (post-T-1015-3 migration)', () => {
	const page = PAGE;

	it('test_the_page_no_longer_composes_through_the_shells_snippet_regions', () => {
		expect(
			page,
			'the migrated page must not still route content through AppShell snippet regions'
		).not.toMatch(/\{#snippet\s+\w+\(\)\}/);
	});

	it('test_the_action_log_is_not_rendered_a_confirmed_drop_for_this_route', () => {
		expect(
			page,
			'ActivityFeed is a confirmed drop for the migrated route (T-1015-3)'
		).not.toContain('<ActivityFeed');
	});

	it('test_agent_context_comment_is_still_emitted', () => {
		// An agent reads this out of the page's HTML source, so it has to be an
		// actual emitted comment -- not a rendered element, and not dropped.
		// Asserted as three independent facts rather than one exact spelling,
		// so extracting the template into a const stays a refactor.
		// T-1015-9: this markup moved from +page.svelte into WorkbenchShell.svelte
		// (a genuinely new component, AC1) -- the page still renders it, just
		// through that component now, so the source-text check moves with it.
		expect(WORKBENCH_SHELL, 'the agent context must still be raw-injected').toContain('{@html');
		expect(WORKBENCH_SHELL, 'formatAgentToolsContext must still be called').toContain(
			'formatAgentToolsContext('
		);
		expect(WORKBENCH_SHELL, 'the context must still be emitted as an HTML comment').toContain(
			'<!--'
		);
	});

	it('test_both_tool_counts_are_still_rendered_in_the_status_bar', () => {
		// T-1015-9: the status-bar header itself moved into WorkbenchShell.svelte.
		const statusBar = WORKBENCH_SHELL.match(/<header class="status-bar">([\s\S]*?)<\/header>/);
		expect(statusBar, 'the shell no longer renders a status-bar header').not.toBeNull();
		expect(statusBar![1], 'the defined-tool count left the status bar').toContain(
			'formatDefinedStatus('
		);
		expect(statusBar![1], 'the callable-tool count left the status bar').toContain(
			'formatAvailableStatus('
		);
	});
});
