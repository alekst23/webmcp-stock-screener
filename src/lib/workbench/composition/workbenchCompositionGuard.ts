// T-0020-9: `/workbench`'s shared composition (T-0020-1) must be built at
// most once per page instance -- registerWorkbenchComposition() itself stays
// ungated (its own test file and workbenchCompositionRoot.e2e.test.ts call it
// fresh, repeatedly, each expecting a brand-new independent composition), so
// the guard lives here instead: a small stateful wrapper +page.svelte's
// onMount calls through, rather than the composition root directly.
//
// No route currently links into `/workbench`, so a second mount (SPA
// back/forward navigation without a full reload, a future in-app link into
// the route, an HMR-adjacent remount) is latent, not active, today -- but
// without this guard it would silently build a second, disconnected
// WorkspaceRepository/PinnedRunStore/etc that no rendered PanelContainer
// would ever read from again, and every tool name would rebind to it,
// stranding any in-flight call from the first mount's infra.
import type { PanelShellRuntime } from '../../panels/shell/registerPanelTools';
import { registerWorkbenchComposition } from './workbenchCompositionRoot';

export interface WorkbenchCompositionGuard {
	// Idempotent: the first call composes and caches the resulting promise;
	// every later call on the same guard instance returns that same
	// in-flight/settled promise instead of composing again.
	ensure(): Promise<PanelShellRuntime>;
}

// `compose` is injectable so a test can substitute a counting fake instead
// of the real registerWorkbenchComposition() (which registers against
// document.modelContext and seeds a real workspace) -- the real call site
// (`+page.svelte`) never passes it.
export function createWorkbenchCompositionGuard(
	compose: () => Promise<PanelShellRuntime> = registerWorkbenchComposition
): WorkbenchCompositionGuard {
	let promise: Promise<PanelShellRuntime> | null = null;
	return {
		ensure(): Promise<PanelShellRuntime> {
			// Caches the promise itself, not just its resolved value, so two
			// concurrent ensure() calls made before the first composition
			// settles still only ever compose once.
			if (!promise) {
				promise = compose();
			}
			return promise;
		}
	};
}
