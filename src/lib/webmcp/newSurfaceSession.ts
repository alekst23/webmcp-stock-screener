// T-1015-3: the migrated main route's bridge state machine, re-pointed at
// the new panel/workspace composition instead of the legacy engine.
//
// `session.ts`'s startBridgeSession/register.ts's connectWebmcp cannot be
// reused as-is here (AC8 forbids importing the legacy engine client, and
// connectWebmcp's whole signature is `(engine: ResearchEngine, ...)`):
// register.ts's refresh/dispose/unregister machinery exists specifically to
// implement per-tool progressive availability (`spec.available(ws)`), which
// the capability parity check confirmed as a structural drop for the new
// surface -- every new-surface tool group registers unconditionally in one
// pass, with no unregister/dispose concept at all. Reusing that machinery
// here would resurrect a mechanism the parity check found nothing on the
// new surface implements.
//
// What DOES survive unchanged, exactly as the ticket's Technical
// Considerations describe, is status.ts's formatters -- this module only
// re-points what feeds them: `compose` is the composition root's own
// guarded entry point (e.g. WorkbenchCompositionGuard.ensure), and the
// "defined"/"available" split collapses to one number, read straight off
// document.modelContext.getTools() after composition settles, since there
// is no separate progressive-availability count left to report.
import { ensureModelContext } from './bridge';
import { buildWebmcpStatus, type WebmcpBridgeState, type WebmcpStatus } from './status';

export interface NewSurfaceBridgeResult<T> {
	// null when composition rejected -- the caller has no runtime to render.
	result: T | null;
	status: WebmcpStatus;
}

// Reports 'connecting' synchronously (before `compose` can possibly
// resolve), then awaits it. A resolved compose is 'connected'; a rejected
// one is 'failed', with the underlying error logged to the console (never
// the header -- spec.md's "the failure be reported with the reason
// surfaced" applies to whoever is diagnosing the page, not the researcher's
// one-clause header line).
export async function connectNewSurfaceBridge<T>(
	compose: () => Promise<T>,
	onState: (state: WebmcpBridgeState) => void
): Promise<NewSurfaceBridgeResult<T>> {
	onState('connecting');
	try {
		const result = await compose();
		const mc = ensureModelContext();
		const tools = (await mc.getTools?.()) ?? [];
		onState('connected');
		return { result, status: buildWebmcpStatus(tools) };
	} catch (error) {
		console.error('WebMCP bridge failed to connect', error);
		onState('failed');
		return { result: null, status: buildWebmcpStatus([]) };
	}
}
