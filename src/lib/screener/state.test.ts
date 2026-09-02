import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type WorkspaceDocument } from '../workbench/domain/workspace';
import { createScreener, type ScreenerDefinition } from './definition';
import { createIdSequencer } from '../workbench/domain/ids';
import {
	readScreener,
	readScreeners,
	removeScreener,
	SCREENER_EXTENSION_KEY,
	writeScreener
} from './state';

function baseWorkspace(): WorkspaceDocument {
	return emptyWorkspace('workspace_1', 'Test Workspace', '2026-01-01T00:00:00.000Z');
}

function sampleScreener(): ScreenerDefinition {
	return createScreener(createIdSequencer(), 'workspace_1', 'Sample');
}

describe('readScreeners', () => {
	it('test_readScreeners_on_document_with_no_screener_extension_returns_empty_array', () => {
		const doc = baseWorkspace();
		expect(readScreeners(doc), 'no extensions.screener key means no screeners').toEqual([]);
	});

	it('test_readScreeners_normalizes_a_corrupt_entry_instead_of_throwing', () => {
		const doc: WorkspaceDocument = {
			...baseWorkspace(),
			extensions: { [SCREENER_EXTENSION_KEY]: { screener_1: 'not an object' } }
		};
		expect(() => readScreeners(doc), 'a corrupt stored entry must not throw').not.toThrow();
		const results = readScreeners(doc);
		expect(results.length, 'the corrupt entry still yields one normalized screener').toBe(1);
		expect(
			results[0]?.screenerId,
			'a corrupt entry normalizes to an empty-string screener ID'
		).toBe('');
	});
});

describe('readScreener / writeScreener', () => {
	it('test_writeScreener_on_empty_document_is_retrievable_via_readScreener', () => {
		const doc = baseWorkspace();
		const screener = sampleScreener();
		const written = writeScreener(doc, screener);
		const found = readScreener(written, screener.screenerId);
		expect(found, 'a written screener must be readable back by its ID').toEqual(screener);
	});

	it('test_writeScreener_does_not_mutate_the_original_document', () => {
		const doc = baseWorkspace();
		const originalExtensions = doc.extensions;
		writeScreener(doc, sampleScreener());
		expect(doc.extensions, 'the original document object must be untouched').toBe(
			originalExtensions
		);
		expect(
			Object.keys(doc.extensions),
			'the original document must still have no screener extension key'
		).toEqual([]);
	});

	it('test_writeScreener_twice_with_different_ids_preserves_both', () => {
		const ids = createIdSequencer();
		const first = createScreener(ids, 'workspace_1', 'First');
		const second = createScreener(ids, 'workspace_1', 'Second');
		let doc = baseWorkspace();
		doc = writeScreener(doc, first);
		doc = writeScreener(doc, second);
		expect(readScreener(doc, first.screenerId), 'the first screener must still be present').toEqual(
			first
		);
		expect(readScreener(doc, second.screenerId), 'the second screener must be present too').toEqual(
			second
		);
	});

	it('test_writeScreener_same_id_again_replaces_without_disturbing_others', () => {
		const ids = createIdSequencer();
		const first = createScreener(ids, 'workspace_1', 'First');
		const second = createScreener(ids, 'workspace_1', 'Second');
		let doc = baseWorkspace();
		doc = writeScreener(doc, first);
		doc = writeScreener(doc, second);
		const updatedFirst: ScreenerDefinition = { ...first, name: 'Renamed', revision: 2 };
		doc = writeScreener(doc, updatedFirst);
		expect(
			readScreener(doc, first.screenerId),
			'the replaced screener must reflect the update'
		).toEqual(updatedFirst);
		expect(
			readScreener(doc, second.screenerId),
			'the untouched screener must be unaffected'
		).toEqual(second);
	});

	it('test_readScreener_returns_null_for_unknown_id', () => {
		const doc = writeScreener(baseWorkspace(), sampleScreener());
		expect(
			readScreener(doc, 'screener_999'),
			'an unknown screener ID must read as null'
		).toBeNull();
	});
});

describe('removeScreener', () => {
	it('test_removeScreener_removes_only_the_named_screener', () => {
		const ids = createIdSequencer();
		const first = createScreener(ids, 'workspace_1', 'First');
		const second = createScreener(ids, 'workspace_1', 'Second');
		let doc = baseWorkspace();
		doc = writeScreener(doc, first);
		doc = writeScreener(doc, second);
		doc = removeScreener(doc, first.screenerId);
		expect(readScreener(doc, first.screenerId), 'the removed screener must be gone').toBeNull();
		expect(readScreener(doc, second.screenerId), 'the other screener must remain').toEqual(second);
	});

	it('test_removeScreener_leaves_unrelated_extension_keys_untouched', () => {
		const screener = sampleScreener();
		let doc = writeScreener(baseWorkspace(), screener);
		doc = { ...doc, extensions: { ...doc.extensions, someOtherEpic: { untouched: true } } };
		const after = removeScreener(doc, screener.screenerId);
		expect(
			after.extensions.someOtherEpic,
			"a sibling extension key must survive removeScreener untouched, per workspace.ts's contract"
		).toEqual({ untouched: true });
	});

	it('test_removeScreener_is_a_no_op_copy_when_id_was_never_present', () => {
		const doc = writeScreener(baseWorkspace(), sampleScreener());
		const after = removeScreener(doc, 'screener_999');
		expect(
			readScreeners(after),
			'removing an unknown ID must not change existing screeners'
		).toEqual(readScreeners(doc));
	});
});
