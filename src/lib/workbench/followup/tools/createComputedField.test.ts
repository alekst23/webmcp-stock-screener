import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readComputedField } from '../domain/computedField';
import { buildCreateComputedFieldTool, type CreateComputedFieldDeps } from './createComputedField';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

interface SuccessPayload {
	change_id: string;
	new_revision: number;
	affected_ids: string[];
	warnings: string[];
	undo_token: string | null;
	computed_field_id: string;
	computed_field: {
		computed_field_id: string;
		name: string;
		result_type: string;
		result_unit: string | null;
	};
}

interface FailurePayload {
	error: string;
	message: string;
	issues?: string[];
	permitted_vocabulary?: string[];
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

const CLOSE_FIELD = { kind: 'field_ref', fieldId: 'field.price.close' };

describe('create_computed_field', () => {
	let deps: CreateComputedFieldDeps;
	let tool: ToolSpec;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace(WORKSPACE_ID, 'Test', NOW));
		repository.setActiveId(WORKSPACE_ID);
		const ids = createIdSequencer();
		deps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids,
				idempotency: createIdempotencyCache()
			}),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids
		};
		tool = buildCreateComputedFieldTool(deps);
	});

	it('creates a field, reporting its stable id, result type and unit (AC1)', async () => {
		const result = await tool.execute({ name: 'Close price', expression: CLOSE_FIELD });
		expect(result.isError).toBeUndefined();
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.computed_field_id).toBe('field.custom.1');
		expect(payload.computed_field.result_type).toBe('number');
		expect(payload.computed_field.result_unit).toBe('currency');
		expect(payload.undo_token).not.toBeNull();
	});

	it('rejects an expression referencing an unknown field, naming it and offering alternatives (AC5)', async () => {
		const result = await tool.execute({
			name: 'x',
			expression: { kind: 'field_ref', fieldId: 'field.nonexistent_thing' }
		});
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('unresolved_field');
		expect(payload.message).toContain('field.nonexistent_thing');
		expect(Array.isArray(payload.permitted_vocabulary)).toBe(true);
	});

	it('rejects a body supplied as a free-form string without evaluating it (AC6)', async () => {
		const result = await tool.execute({ name: 'x', expression: 'DROP TABLE stocks; --' });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('unknown_node_kind');
		// The only observable side effect a real evaluation could have left is a
		// stored record -- there is none, proving nothing was executed.
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(1);
	});

	it('rejects a type mismatch (AC7)', async () => {
		const result = await tool.execute({
			name: 'x',
			expression: {
				kind: 'comparison',
				op: '>',
				left: { kind: 'field_ref', fieldId: 'field.symbol' }, // string
				right: { kind: 'literal', valueType: 'number', value: 1 }
			}
		});
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('type_mismatch');
	});

	it('rejects an expression exceeding the configured node-count limit, naming the limit hit (AC7)', async () => {
		// A balanced tree of depth 6 (well under DEFAULT_EXPRESSION_LIMITS.maxDepth,
		// 8) has 2^7-1 = 127 nodes, over maxNodes (64) -- this trips node-count
		// without also tripping depth, unlike a long linear chain would.
		function balanced(depth: number): unknown {
			if (depth === 0) {
				return { kind: 'literal', valueType: 'number', value: 1 };
			}
			return { kind: 'arithmetic', op: '+', left: balanced(depth - 1), right: balanced(depth - 1) };
		}
		const result = await tool.execute({ name: 'x', expression: balanced(6) });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('node_count_exceeded');
		expect(payload.message).toMatch(/64/);
	});

	it('rejects a name collision explicitly, naming the existing field (AC11)', async () => {
		await tool.execute({ name: 'Close price', expression: CLOSE_FIELD });
		const result = await tool.execute({ name: 'Close price', expression: CLOSE_FIELD });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('operation_validation_error');
		expect(payload.issues?.[0]).toContain('field.custom.1');
		// No second field was created.
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(2); // one create only
	});

	it('a repeated idempotency_key returns the original result without creating a duplicate (AC9)', async () => {
		const first = jsonOf(
			await tool.execute({ name: 'x', expression: CLOSE_FIELD, idempotency_key: 'k1' })
		) as SuccessPayload;
		const second = jsonOf(
			await tool.execute({ name: 'x', expression: CLOSE_FIELD, idempotency_key: 'k1' })
		) as SuccessPayload;
		expect(second.computed_field_id).toBe(first.computed_field_id);
		expect(second.change_id).toBe(first.change_id);
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(2); // one commit, not two
	});

	it('rejects a stale expected_revision without creating anything (AC9)', async () => {
		const result = await tool.execute({
			name: 'x',
			expression: CLOSE_FIELD,
			expected_revision: 99
		});
		expect(result.isError).toBe(true);
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(1);
	});

	it('undoing with the returned undo token removes the field (AC10)', async () => {
		const payload = jsonOf(
			await tool.execute({ name: 'x', expression: CLOSE_FIELD })
		) as SuccessPayload;
		undoChange(payload.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock,
			context: { actor: 'agent' }
		});
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(readComputedField(doc, payload.computed_field_id)).toBeNull();
	});

	it('mutation check: a create that forgot to write the record would still report success -- readComputedField catches it', async () => {
		// Documents what the AC1/undo assertions above actually depend on: the
		// tool's reported computed_field_id must be independently readable back
		// out of the stored document, not merely echoed from the input.
		const payload = jsonOf(
			await tool.execute({ name: 'x', expression: CLOSE_FIELD })
		) as SuccessPayload;
		const doc = deps.repository.get(WORKSPACE_ID)!;
		const stored = readComputedField(doc, payload.computed_field_id);
		expect(stored).not.toBeNull();
		expect(stored?.name).toBe('x');
	});
});
