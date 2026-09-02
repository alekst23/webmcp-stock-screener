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
import { readCustomStudy } from '../domain/customStudy';
import { buildCreateCustomStudyTool, type CreateCustomStudyDeps } from './createCustomStudy';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

interface SuccessPayload {
	change_id: string;
	affected_ids: string[];
	undo_token: string | null;
	custom_study_id: string;
	custom_study: {
		custom_study_id: string;
		name: string;
		parameters: {
			name: string;
			valueType: string;
			defaultValue: unknown;
			range?: { min?: number; max?: number };
		}[];
	};
}

interface FailurePayload {
	error: string;
	message: string;
	issues?: string[];
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

const SMA_EXPRESSION = {
	kind: 'function_call',
	functionId: 'study.sma',
	args: { length: 10 },
	outputName: 'sma'
};

describe('create_custom_study', () => {
	let deps: CreateCustomStudyDeps;
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
		tool = buildCreateCustomStudyTool(deps);
	});

	it('creates a study with a stable id (AC3)', async () => {
		const result = await tool.execute({ name: 'Custom SMA', expression: SMA_EXPRESSION });
		expect(result.isError).toBeUndefined();
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.custom_study_id).toBe('study.custom.1');
		expect(payload.custom_study.name).toBe('Custom SMA');
		expect(payload.undo_token).not.toBeNull();
	});

	it('describes a declared parameter with its default and range the same way a built-in study does (AC3, AC4)', async () => {
		const result = await tool.execute({
			name: 'Custom SMA',
			expression: SMA_EXPRESSION,
			parameters: [
				{ name: 'window', nodePath: 'root', argName: 'length', range: { min: 5, max: 100 } }
			]
		});
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.custom_study.parameters).toEqual([
			{
				name: 'window',
				valueType: 'number',
				unit: 'bars',
				defaultValue: 10,
				range: { min: 5, max: 100 },
				enumValues: undefined,
				required: false
			}
		]);
	});

	it('rejects a parameter naming an argument the function does not declare, offering the permitted alternative (AC5)', async () => {
		const result = await tool.execute({
			name: 'x',
			expression: SMA_EXPRESSION,
			parameters: [{ name: 'window', nodePath: 'root', argName: 'nonexistent' }]
		});
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('invalid_request');
		expect(payload.issues?.[0]).toContain('length');
	});

	it('rejects a body supplied as a free-form string without evaluating it (AC6)', async () => {
		const result = await tool.execute({
			name: 'x',
			expression: 'require("fs").rmSync("/", {recursive:true})'
		});
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('unknown_node_kind');
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(1);
	});

	it('rejects an unresolved function id, naming it (AC5)', async () => {
		const result = await tool.execute({
			name: 'x',
			expression: { kind: 'function_call', functionId: 'study.nonexistent', args: {} }
		});
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('unresolved_function');
		expect(payload.message).toContain('study.nonexistent');
	});

	it('rejects a name collision explicitly (AC11)', async () => {
		await tool.execute({ name: 'Custom SMA', expression: SMA_EXPRESSION });
		const result = await tool.execute({ name: 'Custom SMA', expression: SMA_EXPRESSION });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('operation_validation_error');
		expect(payload.issues?.[0]).toContain('study.custom.1');
	});

	it('a repeated idempotency_key returns the original result without creating a duplicate (AC9)', async () => {
		const first = jsonOf(
			await tool.execute({ name: 'x', expression: SMA_EXPRESSION, idempotency_key: 'k1' })
		) as SuccessPayload;
		const second = jsonOf(
			await tool.execute({ name: 'x', expression: SMA_EXPRESSION, idempotency_key: 'k1' })
		) as SuccessPayload;
		expect(second.custom_study_id).toBe(first.custom_study_id);
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(2);
	});

	it('rejects a stale expected_revision without creating anything (AC9)', async () => {
		const result = await tool.execute({
			name: 'x',
			expression: SMA_EXPRESSION,
			expected_revision: 99
		});
		expect(result.isError).toBe(true);
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(1);
	});

	it('undoing with the returned undo token removes the study (AC10)', async () => {
		const payload = jsonOf(
			await tool.execute({ name: 'x', expression: SMA_EXPRESSION })
		) as SuccessPayload;
		undoChange(payload.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock,
			context: { actor: 'agent' }
		});
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(readCustomStudy(doc, payload.custom_study_id)).toBeNull();
	});
});
