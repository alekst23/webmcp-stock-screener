import { describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import {
	computedFieldIdSeed,
	customStudyIdSeed,
	mintComputedFieldId,
	mintCustomStudyId
} from './followupIds';

describe('mintComputedFieldId', () => {
	it('mints a catalog-shaped id under the field.custom namespace', () => {
		const ids = createIdSequencer();
		expect(mintComputedFieldId(ids)).toBe('field.custom.1');
		expect(mintComputedFieldId(ids)).toBe('field.custom.2');
	});

	it('never repeats an id within a session, even after the sequencer is asked for a study id too', () => {
		const ids = createIdSequencer();
		expect(mintComputedFieldId(ids)).toBe('field.custom.1');
		expect(mintCustomStudyId(ids)).toBe('study.custom.1');
		expect(mintComputedFieldId(ids)).toBe('field.custom.2');
	});
});

describe('mintCustomStudyId', () => {
	it('mints a catalog-shaped id under the study.custom namespace', () => {
		const ids = createIdSequencer();
		expect(mintCustomStudyId(ids)).toBe('study.custom.1');
		expect(mintCustomStudyId(ids)).toBe('study.custom.2');
	});
});

describe('computedFieldIdSeed / customStudyIdSeed', () => {
	it('seeds past the highest stored sequence so a reload never re-mints a live id', () => {
		const seed = computedFieldIdSeed(['field.custom.1', 'field.custom.3', 'field.custom.2']);
		const ids = createIdSequencer(seed);
		expect(mintComputedFieldId(ids)).toBe('field.custom.4');
	});

	it('ignores ids from the other namespace and foreign strings', () => {
		const seed = computedFieldIdSeed(['study.custom.9', 'field.close', 'garbage']);
		const ids = createIdSequencer(seed);
		expect(mintComputedFieldId(ids)).toBe('field.custom.1');
	});

	it('seeds custom study ids independently from computed field ids', () => {
		const seed = customStudyIdSeed(['study.custom.5']);
		const ids = createIdSequencer(seed);
		expect(mintCustomStudyId(ids)).toBe('study.custom.6');
		expect(mintComputedFieldId(ids)).toBe('field.custom.1');
	});

	it('mutation check: without seeding, a reload restarts at 1 and would collide with a live id', () => {
		// Demonstrates why computedFieldIdSeed exists: an unseeded sequencer
		// re-mints an id already in use by a still-referenced record.
		const idsWithoutSeed = createIdSequencer();
		expect(mintComputedFieldId(idsWithoutSeed)).toBe('field.custom.1');
	});
});
