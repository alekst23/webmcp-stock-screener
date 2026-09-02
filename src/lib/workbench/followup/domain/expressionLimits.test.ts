import { describe, expect, it } from 'vitest';
import { listCatalogItems } from '../../../catalog/registry';
import { DEFAULT_EXPRESSION_LIMITS } from './expressionLimits';

describe('expressionLimits', () => {
	it('test_default_limits_match_the_documented_defaults', () => {
		expect(DEFAULT_EXPRESSION_LIMITS.maxDepth, 'maxDepth default drifted').toBe(8);
		expect(DEFAULT_EXPRESSION_LIMITS.maxNodes, 'maxNodes default drifted').toBe(64);
		expect(DEFAULT_EXPRESSION_LIMITS.maxLookbackBars, 'maxLookbackBars default drifted').toBe(500);
	});

	it('test_default_lookback_limit_does_not_clip_any_built_in_bars_parameter', () => {
		const overLimit: string[] = [];
		for (const item of listCatalogItems()) {
			if (item.kind !== 'study' && item.kind !== 'indicator' && item.kind !== 'pattern') continue;
			for (const param of item.parameters) {
				if (param.unit !== 'bars' || param.range?.max === undefined) continue;
				if (param.range.max > DEFAULT_EXPRESSION_LIMITS.maxLookbackBars) {
					overLimit.push(`${item.id}.${param.name} (max ${param.range.max})`);
				}
			}
		}
		expect(
			overLimit,
			`built-in catalog parameters exceed the default lookback limit: ${overLimit.join(', ')}`
		).toEqual([]);
	});
});
