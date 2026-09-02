import { describe, expect, it } from 'vitest';
import {
	isGatedFollowupTool,
	unmetFollowupPrerequisite,
	type FollowupAvailabilitySnapshot
} from './followupAvailability';

const NOTHING: FollowupAvailabilitySnapshot = {
	hasScreener: false,
	hasPinnedRun: false,
	hasCapturedSetup: false,
	hasSimilaritySearch: false
};

const EVERYTHING: FollowupAvailabilitySnapshot = {
	hasScreener: true,
	hasPinnedRun: true,
	hasCapturedSetup: true,
	hasSimilaritySearch: true
};

describe('followupAvailability', () => {
	it('gates exactly the five tools with a workspace-wide prerequisite', () => {
		const gated = [
			'backtest_screener',
			'save_results_to_watchlist',
			'export_results',
			'derive_filters_from_setup',
			'refine_similarity_search'
		];
		for (const name of gated) {
			expect(isGatedFollowupTool(name)).toBe(true);
		}
		const ungated = [
			'get_backtest_results',
			'upsert_watchlist',
			'create_computed_field',
			'create_custom_study',
			'create_alert_draft',
			'preview_alert',
			'enable_alert',
			'disable_alert',
			'edit_alert_draft'
		];
		for (const name of ungated) {
			expect(isGatedFollowupTool(name)).toBe(false);
		}
	});

	it('backtest_screener requires a screener', () => {
		expect(unmetFollowupPrerequisite('backtest_screener', {}, NOTHING)).toEqual({
			prerequisite: 'screener',
			message: expect.stringContaining('create_screener')
		});
		expect(unmetFollowupPrerequisite('backtest_screener', {}, EVERYTHING)).toBeNull();
	});

	it('save_results_to_watchlist and export_results require a pinned run', () => {
		for (const name of ['save_results_to_watchlist', 'export_results']) {
			expect(unmetFollowupPrerequisite(name, {}, NOTHING)).toEqual({
				prerequisite: 'pinned_run',
				message: expect.stringContaining('run_screener')
			});
			expect(unmetFollowupPrerequisite(name, {}, EVERYTHING)).toBeNull();
		}
	});

	it('derive_filters_from_setup requires a captured setup for the default/derive operation only', () => {
		expect(unmetFollowupPrerequisite('derive_filters_from_setup', {}, NOTHING)).toEqual({
			prerequisite: 'captured_setup',
			message: expect.stringContaining('capture_chart_setup')
		});
		expect(
			unmetFollowupPrerequisite('derive_filters_from_setup', { operation: 'derive' }, NOTHING)
		).not.toBeNull();
		// edit/accept act on an existing draft, which is a per-call concern,
		// not a surface-wide gate -- never blocked here regardless of setups.
		expect(
			unmetFollowupPrerequisite(
				'derive_filters_from_setup',
				{ operation: 'edit', draft_id: 'filter_draft_1' },
				NOTHING
			)
		).toBeNull();
		expect(
			unmetFollowupPrerequisite(
				'derive_filters_from_setup',
				{ operation: 'accept', draft_id: 'filter_draft_1' },
				NOTHING
			)
		).toBeNull();
		expect(
			unmetFollowupPrerequisite('derive_filters_from_setup', { operation: 'derive' }, EVERYTHING)
		).toBeNull();
	});

	it('refine_similarity_search requires an existing similarity search', () => {
		expect(unmetFollowupPrerequisite('refine_similarity_search', {}, NOTHING)).toEqual({
			prerequisite: 'similarity_search',
			message: expect.stringContaining('find_similar_setups')
		});
		expect(unmetFollowupPrerequisite('refine_similarity_search', {}, EVERYTHING)).toBeNull();
	});

	it('a tool with no known prerequisite is always available, regardless of workspace state', () => {
		expect(unmetFollowupPrerequisite('create_computed_field', {}, NOTHING)).toBeNull();
		expect(unmetFollowupPrerequisite('unknown_tool_name', {}, NOTHING)).toBeNull();
	});

	it('malformed input (non-object) is treated as the default derive operation, not a crash', () => {
		expect(() =>
			unmetFollowupPrerequisite('derive_filters_from_setup', null, NOTHING)
		).not.toThrow();
		expect(unmetFollowupPrerequisite('derive_filters_from_setup', null, NOTHING)).toEqual({
			prerequisite: 'captured_setup',
			message: expect.any(String)
		});
	});
});
