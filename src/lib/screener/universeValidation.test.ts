import { describe, expect, it } from 'vitest';
import type { CatalogRegistry } from '../catalog/registry';
import type { CatalogItem, UniverseItem } from '../catalog/types';
import { emptyUniverse } from './definition';
import { checkUniverseCatalogMembership, describeUniverseSizeWarning } from './universeValidation';

function fakeUniverseItem(id: string): UniverseItem {
	return {
		id,
		kind: 'universe',
		label: id,
		description: 'test universe item',
		aliases: [],
		tags: [],
		membershipSource: 'test fixture',
		availability: { status: 'available', requiresReferenceData: false, intervalIds: [] }
	};
}

function fakeCatalog(
	items: CatalogItem[],
	suggestions: Record<string, string[]> = {}
): CatalogRegistry {
	const byId = new Map(items.map((item) => [item.id, item]));
	return {
		getCatalogItem: (id) => byId.get(id),
		listCatalogItems: (kind) => (kind ? items.filter((i) => i.kind === kind) : items),
		searchCatalogItems: () => [],
		isOperatorValidForField: () => ({ valid: true }),
		resolveStudy: () => undefined,
		suggestCatalogIds: (unknownId) => suggestions[unknownId] ?? []
	};
}

describe('checkUniverseCatalogMembership', () => {
	it('accepts an index id that exists in the catalog as kind universe', () => {
		const catalog = fakeCatalog([fakeUniverseItem('universe.sp500')]);
		const universe = { ...emptyUniverse(), indexes: ['universe.sp500'] };
		const check = checkUniverseCatalogMembership(universe, catalog);
		expect(check.unknownIndexIds, 'a known index id must not be reported as unknown').toEqual([]);
	});

	it('rejects an index id absent from the catalog and carries suggestions', () => {
		const catalog = fakeCatalog([fakeUniverseItem('universe.sp500')], {
			'universe.sp50': ['universe.sp500']
		});
		const universe = { ...emptyUniverse(), indexes: ['universe.sp50'] };
		const check = checkUniverseCatalogMembership(universe, catalog);
		expect(check.unknownIndexIds).toEqual(['universe.sp50']);
		expect(check.suggestionsByIndex['universe.sp50']).toEqual(['universe.sp500']);
	});

	it('rejects an id that exists in the catalog but under a different kind', () => {
		const nonUniverseItem: CatalogItem = {
			id: 'field.price.close',
			kind: 'field',
			label: 'Close price',
			description: 'test',
			aliases: [],
			tags: [],
			valueType: 'number',
			nullable: false,
			availability: { status: 'available', requiresReferenceData: false, intervalIds: [] }
		};
		const catalog = fakeCatalog([nonUniverseItem]);
		const universe = { ...emptyUniverse(), indexes: ['field.price.close'] };
		const check = checkUniverseCatalogMembership(universe, catalog);
		expect(
			check.unknownIndexIds,
			'an id of the wrong catalog kind is not a valid index reference'
		).toEqual(['field.price.close']);
	});

	it('carries no unverifiable warning when exchanges/countries/sectors/industries are all empty', () => {
		const catalog = fakeCatalog([]);
		const check = checkUniverseCatalogMembership(emptyUniverse(), catalog);
		expect(check.unverifiableWarning).toBeNull();
	});

	it('warns, naming only the dimensions actually supplied, when they cannot be verified', () => {
		const catalog = fakeCatalog([]);
		const universe = { ...emptyUniverse(), exchanges: ['XNAS'], sectors: ['tech'] };
		const check = checkUniverseCatalogMembership(universe, catalog);
		expect(check.unverifiableWarning, 'a warning must fire').not.toBeNull();
		expect(check.unverifiableWarning).toContain('exchanges');
		expect(check.unverifiableWarning).toContain('sectors');
		expect(
			check.unverifiableWarning,
			'must not name a dimension that was not supplied'
		).not.toContain('countries');
		expect(check.unverifiableWarning).not.toContain('industries');
	});
});

describe('describeUniverseSizeWarning', () => {
	it('warns the size is unknown, not zero, when resolution was not possible', () => {
		const warning = describeUniverseSizeWarning({ resolvable: false, count: 0 });
		expect(warning, 'must state unknown').toContain('unknown');
		expect(
			warning,
			'must never claim the universe resolves to zero when it was not actually resolved'
		).not.toContain('resolves to zero');
	});

	it('warns the universe resolves to zero instruments when resolvable and empty', () => {
		const warning = describeUniverseSizeWarning({ resolvable: true, count: 0 });
		expect(warning).toContain('zero');
	});

	it('carries no warning when resolvable and non-empty', () => {
		const warning = describeUniverseSizeWarning({ resolvable: true, count: 42 });
		expect(warning).toBeNull();
	});
});
