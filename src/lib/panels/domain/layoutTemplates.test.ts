import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, GRID_ROWS } from './grid';
import { rectsOverlap, validatePlacement } from './layout';
import {
	createLayoutTemplateRegistry,
	LayoutTemplateConflictError,
	registerDefaultLayoutTemplates,
	UnknownLayoutTemplateError,
	type LayoutTemplate
} from './layoutTemplates';

const NO_MIN = { colSpan: 1, rowSpan: 1 };

function slotsFitAndDoNotOverlap(template: LayoutTemplate): void {
	for (const slot of template.slots) {
		const result = validatePlacement({ rect: slot, minSize: NO_MIN, occupied: [] });
		expect(
			result.ok,
			`template "${template.name}" slot ${JSON.stringify(slot)} does not fit the 6x4 grid: ${JSON.stringify(result)}`
		).toBe(true);
	}
	for (const [i, a] of template.slots.entries()) {
		for (const [offset, b] of template.slots.slice(i + 1).entries()) {
			expect(
				rectsOverlap(a, b),
				`template "${template.name}" slots ${i} and ${i + 1 + offset} overlap: ${JSON.stringify(template.slots)}`
			).toBe(false);
		}
	}
}

describe('createLayoutTemplateRegistry', () => {
	it('starts empty and independent of the module-global registry', () => {
		const registry = createLayoutTemplateRegistry();
		expect(registry.names(), 'expected a fresh registry to start empty').toEqual([]);
	});

	it('registers and retrieves a template by name', () => {
		const registry = createLayoutTemplateRegistry();
		const template: LayoutTemplate = {
			name: 'solo',
			slots: [{ col: 0, row: 0, colSpan: 6, rowSpan: 4 }]
		};
		registry.register(template);
		expect(registry.get('solo')).toEqual(template);
	});

	it('throws LayoutTemplateConflictError on a duplicate name', () => {
		const registry = createLayoutTemplateRegistry();
		const template: LayoutTemplate = {
			name: 'solo',
			slots: [{ col: 0, row: 0, colSpan: 6, rowSpan: 4 }]
		};
		registry.register(template);
		expect(() => registry.register(template)).toThrow(LayoutTemplateConflictError);
	});

	it('require() throws UnknownLayoutTemplateError listing registered names', () => {
		const registry = createLayoutTemplateRegistry();
		registry.register({ name: 'solo', slots: [{ col: 0, row: 0, colSpan: 6, rowSpan: 4 }] });
		try {
			registry.require('missing');
			expect.fail('expected require() to throw for an unregistered template');
		} catch (err) {
			expect(err).toBeInstanceOf(UnknownLayoutTemplateError);
			if (err instanceof UnknownLayoutTemplateError) {
				expect(err.template).toBe('missing');
				expect(err.registeredTemplates).toEqual(['solo']);
			}
		}
	});

	it('require() returns the template when it exists', () => {
		const registry = createLayoutTemplateRegistry();
		const template: LayoutTemplate = {
			name: 'solo',
			slots: [{ col: 0, row: 0, colSpan: 6, rowSpan: 4 }]
		};
		registry.register(template);
		expect(registry.require('solo')).toEqual(template);
	});

	it('get() returns undefined for an unregistered template', () => {
		const registry = createLayoutTemplateRegistry();
		expect(registry.get('missing')).toBeUndefined();
	});

	it('list() returns every registered template', () => {
		const registry = createLayoutTemplateRegistry();
		const a: LayoutTemplate = { name: 'a', slots: [{ col: 0, row: 0, colSpan: 3, rowSpan: 4 }] };
		const b: LayoutTemplate = { name: 'b', slots: [{ col: 3, row: 0, colSpan: 3, rowSpan: 4 }] };
		registry.register(a);
		registry.register(b);
		expect(registry.list()).toEqual([a, b]);
	});
});

describe('registerDefaultLayoutTemplates', () => {
	it('registers exactly the four named templates', () => {
		const registry = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(registry);
		expect(registry.names().sort()).toEqual(
			['chart_wall_3x3', 'focus_with_sidebar', 'quad', 'three_columns'].sort()
		);
	});

	it('does not register the default seeded workspace arrangement as a template', () => {
		const registry = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(registry);
		expect(registry.get('default')).toBeUndefined();
		expect(registry.get('seeded')).toBeUndefined();
		expect(registry.get('research_layout')).toBeUndefined();
	});

	for (const name of ['three_columns', 'quad', 'chart_wall_3x3', 'focus_with_sidebar']) {
		it(`"${name}" fits entirely inside the 6x4 grid with no overlapping slots`, () => {
			const registry = createLayoutTemplateRegistry();
			registerDefaultLayoutTemplates(registry);
			slotsFitAndDoNotOverlap(registry.require(name));
		});
	}

	it('"chart_wall_3x3" has exactly 9 slots', () => {
		const registry = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(registry);
		expect(registry.require('chart_wall_3x3').slots).toHaveLength(9);
	});

	it('"quad" has exactly 4 slots', () => {
		const registry = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(registry);
		expect(registry.require('quad').slots).toHaveLength(4);
	});

	it('"three_columns" has exactly 3 slots each spanning the full grid height', () => {
		const registry = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(registry);
		const template = registry.require('three_columns');
		expect(template.slots).toHaveLength(3);
		for (const slot of template.slots) {
			expect(slot.rowSpan).toBe(GRID_ROWS);
		}
	});

	it('"focus_with_sidebar" has one large focus slot and two sidebar slots', () => {
		const registry = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(registry);
		const template = registry.require('focus_with_sidebar');
		expect(template.slots).toHaveLength(3);
		const [focus] = template.slots;
		expect(focus, 'expected a first slot').toBeDefined();
		expect(focus?.rowSpan).toBe(GRID_ROWS);
		expect(focus?.colSpan).toBeGreaterThan(1);
	});

	it('every default template slot stays within GRID_COLUMNS x GRID_ROWS', () => {
		const registry = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(registry);
		for (const template of registry.list()) {
			for (const slot of template.slots) {
				expect(
					slot.col + slot.colSpan,
					`${template.name} slot ${JSON.stringify(slot)} exceeds columns`
				).toBeLessThanOrEqual(GRID_COLUMNS);
				expect(
					slot.row + slot.rowSpan,
					`${template.name} slot ${JSON.stringify(slot)} exceeds rows`
				).toBeLessThanOrEqual(GRID_ROWS);
			}
		}
	});
});

describe('module-scoped layoutTemplateRegistry singleton', () => {
	it('comes pre-populated with the four default templates', async () => {
		const { layoutTemplateRegistry } = await import('./layoutTemplates');
		expect(layoutTemplateRegistry.names().sort()).toEqual(
			['chart_wall_3x3', 'focus_with_sidebar', 'quad', 'three_columns'].sort()
		);
	});
});
