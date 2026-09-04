import { describe, expect, it } from 'vitest';
import type { CatalogRegistry } from '../../catalog/registry';
import type { CatalogItem } from '../../catalog/types';
import type { ValidationProblem } from '../../screener/validation';
import { buildRankingSpec } from './defineScreenerRanking';

function fixtureRegistry(items: CatalogItem[]): CatalogRegistry {
	const byId = new Map(items.map((item) => [item.id, item]));
	return {
		getCatalogItem: (id) => byId.get(id),
		listCatalogItems: (kind) => (kind ? items.filter((i) => i.kind === kind) : items),
		searchCatalogItems: () => [],
		isOperatorValidForField: () => ({ valid: true }),
		resolveStudy: () => undefined,
		suggestCatalogIds: () => []
	};
}

const VOLUME_FIELD: CatalogItem = {
	id: 'field.volume',
	kind: 'field',
	label: 'Volume',
	description: 'Shares traded.',
	aliases: [],
	tags: [],
	valueType: 'number',
	nullable: false,
	availability: { status: 'available', requiresReferenceData: false, intervalIds: [] }
};

const SYMBOL_FIELD: CatalogItem = {
	id: 'field.symbol',
	kind: 'field',
	label: 'Symbol',
	description: 'Ticker.',
	aliases: [],
	tags: [],
	valueType: 'string',
	nullable: false,
	availability: { status: 'available', requiresReferenceData: false, intervalIds: [] }
};

describe('buildRankingSpec', () => {
	it('omittedRankingAndLimit_resetsToNoRanking', () => {
		const problems: ValidationProblem[] = [];
		const ranking = buildRankingSpec(undefined, undefined, fixtureRegistry([]), problems);
		expect(ranking).toBeNull();
		expect(problems).toEqual([]);
	});

	it('limitAlone_stillBuildsARankingSpec_soMakeItTopNWorksWithoutFields', () => {
		const problems: ValidationProblem[] = [];
		const ranking = buildRankingSpec(undefined, 20, fixtureRegistry([]), problems);
		expect(ranking, 'a bare "make it top 20" call must not be silently dropped').not.toBeNull();
		expect(ranking?.limit).toBe(20);
		expect(ranking?.fields).toEqual([]);
	});

	it('validFields_buildARankingSpec', () => {
		const problems: ValidationProblem[] = [];
		const ranking = buildRankingSpec(
			{ fields: [{ field_id: 'field.volume', direction: 'desc' }] },
			50,
			fixtureRegistry([VOLUME_FIELD]),
			problems
		);
		expect(problems).toEqual([]);
		expect(ranking?.fields).toEqual([{ fieldId: 'field.volume', direction: 'desc', weight: 1 }]);
		expect(ranking?.limit).toBe(50);
	});

	it('unknownField_isRejected_namingIt', () => {
		const problems: ValidationProblem[] = [];
		const ranking = buildRankingSpec(
			{ fields: [{ field_id: 'field.no_such_field' }] },
			undefined,
			fixtureRegistry([VOLUME_FIELD]),
			problems
		);
		expect(ranking).toBeNull();
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message).toContain('field.no_such_field');
	});

	it('nonNumericField_isRejected', () => {
		const problems: ValidationProblem[] = [];
		const ranking = buildRankingSpec(
			{ fields: [{ field_id: 'field.symbol' }] },
			undefined,
			fixtureRegistry([SYMBOL_FIELD]),
			problems
		);
		expect(ranking).toBeNull();
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message).toContain('numeric');
	});

	it('tieBreakOnly_stillBuildsARankingSpec', () => {
		const problems: ValidationProblem[] = [];
		const ranking = buildRankingSpec(
			{ tie_break: { field_id: 'field.volume', direction: 'asc' } },
			undefined,
			fixtureRegistry([VOLUME_FIELD]),
			problems
		);
		expect(problems).toEqual([]);
		expect(ranking?.tieBreak).toEqual({ fieldId: 'field.volume', direction: 'asc' });
	});
});
