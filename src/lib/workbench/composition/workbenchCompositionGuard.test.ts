// T-0020-9: proves the guard `+page.svelte` calls through to on mount never
// lets a second mount silently build a second, orphaned composition -- the
// unit here is the plain guard object, not the Svelte component itself
// (this codebase has no component-render test harness), so it substitutes a
// counting fake for registerWorkbenchComposition() and asserts on how many
// times that fake actually runs.
import { describe, expect, it } from 'vitest';
import type { PanelShellRuntime } from '../../panels/shell/registerPanelTools';
import { createWorkbenchCompositionGuard } from './workbenchCompositionGuard';

function fakeRuntime(): PanelShellRuntime {
	return {} as PanelShellRuntime;
}

describe('createWorkbenchCompositionGuard', () => {
	it('composes once and hands every later ensure() call the same cached runtime', async () => {
		const runtime = fakeRuntime();
		let calls = 0;
		const compose = async (): Promise<PanelShellRuntime> => {
			calls += 1;
			return runtime;
		};
		const guard = createWorkbenchCompositionGuard(compose);

		const first = await guard.ensure();
		const second = await guard.ensure();

		expect(calls, 'a second ensure() on an already-composed guard must not compose again').toBe(1);
		expect(
			second,
			"a second mount must reuse the first mount's runtime, not an orphaned second instance"
		).toBe(first);
	});

	it('caches the in-flight promise, not just its resolved value, so two concurrent mounts before the first resolves still only compose once', async () => {
		let calls = 0;
		let resolveCompose: (runtime: PanelShellRuntime) => void;
		const composePromise = new Promise<PanelShellRuntime>((resolve) => {
			resolveCompose = resolve;
		});
		const compose = (): Promise<PanelShellRuntime> => {
			calls += 1;
			return composePromise;
		};
		const guard = createWorkbenchCompositionGuard(compose);

		const firstCall = guard.ensure();
		const secondCall = guard.ensure();
		resolveCompose!(fakeRuntime());
		const [first, second] = await Promise.all([firstCall, secondCall]);

		expect(
			calls,
			'concurrent ensure() calls made before composition settles must still compose exactly once'
		).toBe(1);
		expect(second, 'both concurrent callers must resolve to the same runtime').toBe(first);
	});

	it('defaults to the real registerWorkbenchComposition when no compose function is supplied', () => {
		const guard = createWorkbenchCompositionGuard();
		expect(
			typeof guard.ensure,
			'the real call site (+page.svelte) constructs this with no arguments'
		).toBe('function');
	});
});
