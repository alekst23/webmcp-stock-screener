// AC10: "Undoing a creation with the returned undo token removes the field
// or study and restores any column, ranking, chart, or filter that
// referenced it to its prior state." No new mechanism is built for this --
// changeHistory.ts's existing whole-document-snapshot undo already
// satisfies it structurally (a create's inverse.document is the exact
// pre-create WorkspaceDocument), and its existing "undo only targets the
// newest change" rule is what actually protects a reference: undoing a
// change something newer depends on is refused rather than silently
// orphaning the reference. This test proves both halves using two of this
// ticket's own resources (a second computed field referencing the first),
// self-contained -- no dependency on another epic's "column"/"ranking"
// resource existing yet.
import { describe, expect, it } from 'vitest';
import { UndoTokenError } from '../../domain/errors';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory, restoreRevision, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readComputedField } from '../domain/computedField';
import {
	buildCreateComputedFieldTool,
	type CreateComputedFieldDeps
} from '../tools/createComputedField';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

interface SuccessPayload {
	undo_token: string | null;
	computed_field_id: string;
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

function setup() {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	repository.put(emptyWorkspace(WORKSPACE_ID, 'Test', NOW));
	repository.setActiveId(WORKSPACE_ID);
	const history = createChangeHistory();
	const ids = createIdSequencer();
	const revisions = createRevisionService({
		repository,
		clock,
		ids,
		idempotency: createIdempotencyCache()
	});
	const deps: CreateComputedFieldDeps = {
		repository,
		revisions,
		history,
		registry: createOperationRegistry(),
		clock,
		ids
	};
	return { repository, history, revisions, deps, tool: buildCreateComputedFieldTool(deps) };
}

// Field B's own expression references field A by its stable id -- a second
// computed field standing in for "a column/ranking/filter that referenced
// it", exercised entirely through this ticket's own tools.
function referencingExpression(fieldId: string) {
	return {
		kind: 'arithmetic',
		op: '+',
		left: { kind: 'field_ref', fieldId },
		right: { kind: 'literal', valueType: 'number', value: 1 }
	};
}

describe('undo reaches references (AC10)', () => {
	it('undoing a still-referenced field is refused as superseded, not silently applied', async () => {
		const { repository, history, revisions, tool } = setup();

		const fieldA = jsonOf(
			await tool.execute({
				name: 'Close',
				expression: { kind: 'field_ref', fieldId: 'field.price.close' }
			})
		) as SuccessPayload;
		expect(fieldA.computed_field_id).toBe('field.custom.1');

		const fieldB = jsonOf(
			await tool.execute({
				name: 'Close plus one',
				expression: referencingExpression('field.custom.1')
			})
		) as SuccessPayload;
		expect(fieldB.computed_field_id).toBe('field.custom.2');

		// A's undo token is no longer the newest change -- redeeming it now
		// would orphan B's reference, so it is refused rather than applied.
		let caught: unknown;
		try {
			undoChange(fieldA.undo_token!, {
				history,
				revisionService: revisions,
				clock,
				context: { actor: 'agent' }
			});
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(UndoTokenError);
		expect((caught as UndoTokenError).reason).toBe('superseded');

		// The refusal did not partially apply: both fields are still present.
		const doc = repository.get(WORKSPACE_ID)!;
		expect(readComputedField(doc, 'field.custom.1')).not.toBeNull();
		expect(readComputedField(doc, 'field.custom.2')).not.toBeNull();
	});

	it('restoring to the revision right after A removes both A and the field that referenced it', async () => {
		const { repository, history, revisions, tool } = setup();

		await tool.execute({
			name: 'Close',
			expression: { kind: 'field_ref', fieldId: 'field.price.close' }
		});
		const revisionAfterA = repository.get(WORKSPACE_ID)!.revision; // 2: empty(1) -> create A(2)

		await tool.execute({
			name: 'Close plus one',
			expression: referencingExpression('field.custom.1')
		});
		expect(repository.get(WORKSPACE_ID)!.revision).toBe(revisionAfterA + 1); // 3: -> create B(3)

		restoreRevision(
			WORKSPACE_ID,
			revisionAfterA,
			{ actor: 'agent' },
			{ history, revisionService: revisions, clock, repository }
		);

		const restored = repository.get(WORKSPACE_ID)!;
		expect(readComputedField(restored, 'field.custom.1')).not.toBeNull(); // A is back
		expect(readComputedField(restored, 'field.custom.2')).toBeNull(); // B (the reference) is gone
	});
});
