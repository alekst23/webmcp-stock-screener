import { describe, expect, it } from 'vitest';
import { parsePanelSourceDrag, serializePanelSourceDrag } from './dragSource';
import type { PanelSourceRef } from './panel';

describe('serializePanelSourceDrag / parsePanelSourceDrag', () => {
	it('round-trips a PanelSourceRef through JSON', () => {
		const source: PanelSourceRef = {
			type: 'instrument',
			ref: { instrument: { instrument_id: 'inst:XNAS:AAPL', symbol: 'AAPL' } }
		};
		expect(parsePanelSourceDrag(serializePanelSourceDrag(source))).toEqual(source);
	});

	it('parses null for malformed JSON rather than throwing', () => {
		expect(parsePanelSourceDrag('not json')).toBeNull();
	});

	it('parses null for JSON missing a string type', () => {
		expect(parsePanelSourceDrag(JSON.stringify({ ref: {} }))).toBeNull();
	});

	it('parses null for JSON missing an object ref', () => {
		expect(parsePanelSourceDrag(JSON.stringify({ type: 'instrument' }))).toBeNull();
	});

	it('parses null for an empty type', () => {
		expect(parsePanelSourceDrag(JSON.stringify({ type: '', ref: {} }))).toBeNull();
	});

	it('parses null for a JSON array', () => {
		expect(parsePanelSourceDrag(JSON.stringify([1, 2, 3]))).toBeNull();
	});
});
