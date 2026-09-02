// AC4: the mutation contract (stale expected_revision rejected without
// mutating, a repeated idempotency_key replays rather than re-applying, and
// the full envelope is always returned) holds uniformly across every
// mutating tool this epic registers. Driven off the actual registered tool
// list (buildAllFollowupTools' own output), per the ticket's own
// instruction, so a future tool added to the surface without this contract
// fails here rather than slipping through. Per-tool fixtures live in
// followupMutatingFixtures.ts, shared with the AC5 undo-reversibility suite.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { buildAllFollowupTools, type FollowupSurfaceRuntime } from './registerAllFollowupTools';
import { jsonOf } from './testFixtures';
import { buildRuntime, FIXTURES, READ_ONLY_TOOLS } from './followupMutatingFixtures';

describe('AC4: uniform mutation contract', () => {
	it('every registered tool is accounted for as exactly one of mutating (fixture below) or read-only', () => {
		const runtime = buildRuntime();
		const names = buildAllFollowupTools(runtime).map((t) => t.name);
		const fixtureNames = new Set(FIXTURES.map((f) => f.name));
		for (const name of names) {
			const accounted = fixtureNames.has(name) || READ_ONLY_TOOLS.has(name);
			expect(accounted, `${name} is neither an AC4 fixture nor a declared read-only tool`).toBe(
				true
			);
		}
	});

	for (const fixture of FIXTURES) {
		describe(fixture.name, () => {
			let runtime: FollowupSurfaceRuntime;
			let byName: Map<string, ToolSpec>;

			beforeEach(() => {
				runtime = buildRuntime();
				byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
			});

			it('rejects a stale expected_revision without mutating anything', async () => {
				const input = await fixture.prepare(runtime, byName);
				const before = runtime.repository.get(runtime.workspaceId)!.revision;
				const result = await byName.get(fixture.name)!.execute({
					...input,
					expected_revision: before - 1
				});
				expect(result.isError, `${fixture.name} should reject a stale expected_revision`).toBe(
					true
				);
				const after = runtime.repository.get(runtime.workspaceId)!.revision;
				expect(after, `${fixture.name} must not mutate on a stale expected_revision`).toBe(before);
			});

			it('a repeated idempotency_key returns the original result without re-applying', async () => {
				const input = await fixture.prepare(runtime, byName);
				const key = `${fixture.name}-key-1`;
				const first = await byName.get(fixture.name)!.execute({ ...input, idempotency_key: key });
				expect(first.isError, JSON.stringify(jsonOf(first))).toBeUndefined();
				const firstPayload = jsonOf(first);
				const revisionAfterFirst = runtime.repository.get(runtime.workspaceId)!.revision;

				const second = await byName.get(fixture.name)!.execute({ ...input, idempotency_key: key });
				expect(second.isError, JSON.stringify(jsonOf(second))).toBeUndefined();
				const secondPayload = jsonOf(second);

				expect(secondPayload.change_id).toBe(firstPayload.change_id);
				expect(secondPayload.new_revision).toBe(firstPayload.new_revision);
				const revisionAfterSecond = runtime.repository.get(runtime.workspaceId)!.revision;
				expect(revisionAfterSecond, 'a replayed call must not bump the revision again').toBe(
					revisionAfterFirst
				);
			});

			it('a successful call returns the full mutation envelope', async () => {
				const input = await fixture.prepare(runtime, byName);
				const result = await byName.get(fixture.name)!.execute(input);
				expect(result.isError, JSON.stringify(jsonOf(result))).toBeUndefined();
				const payload = jsonOf(result);
				expect(payload).toHaveProperty('change_id');
				expect(payload).toHaveProperty('new_revision');
				expect(payload).toHaveProperty('affected_ids');
				expect(payload).toHaveProperty('diff_summary');
				expect(payload).toHaveProperty('warnings');
				expect(payload).toHaveProperty('undo_token');
				expect(Array.isArray(payload.affected_ids)).toBe(true);
				expect(Array.isArray(payload.warnings)).toBe(true);
			});
		});
	}
});
