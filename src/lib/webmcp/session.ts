import type { Writable } from 'svelte/store';
import { connectWebmcp } from './register';
import type { AgentActivityEvent } from '../workspace/activity';
import type { WebmcpBridgeState } from './status';
import type { ResearchEngine } from './types';

// The whole bridge state machine for one page mount, lifted out of
// +page.svelte (hotfix/webmcp-bridge-status). It lived in `onMount` where
// nothing could reach it: covering it there would mean a component-testing
// stack pulling in $env/dynamic/public, the localStorage singleton, and five
// unrelated child components, to test four lines of promise plumbing that
// decide whether the page tells an agent the truth about callability.
//
// The mapping is the contract: a connection -> connected, a rejection ->
// failed (registration threw), and `connecting` until one of those lands.
// There is no browser-capability state, by design: connectWebmcp always has
// a bridge to register against, so the only thing left to report is whether
// registering on it worked -- an observed outcome, never a prediction about
// what this browser supports.
//
// Returns the disposer for the caller's `onMount` cleanup.
export function startBridgeSession(
	engine: ResearchEngine,
	activity: Writable<AgentActivityEvent[]> | undefined,
	onState: (state: WebmcpBridgeState) => void,
	onTools: (names: string[]) => void
): () => void {
	// Cleanup can fire before the connect resolves; the flag lets that case
	// tear down on arrival rather than leak this mount's registrations onto a
	// bridge the next mount will register against again.
	let disposed = false;

	onState('connecting');

	const connecting = connectWebmcp(engine, activity, (names) => {
		if (!disposed) {
			onTools(names);
		}
	})
		.then((connection) => {
			if (disposed) {
				void connection.dispose().catch(() => {});
				return null;
			}
			onState('connected');
			return connection;
		})
		.catch((error: unknown) => {
			// spec.md requires the failure be reported with the underlying error
			// surfaced for diagnosis. The header line has one clause and the
			// researcher cannot act on a stack trace, so the console carries it.
			console.error('WebMCP bridge failed to connect', error);
			if (!disposed) {
				onState('failed');
				// connect() is atomic, so a rejection means nothing is registered;
				// leaving a stale count would claim callable tools that are not.
				onTools([]);
			}
			return null;
		});

	return () => {
		disposed = true;
		void connecting.then((connection) => connection?.dispose()).catch(() => {});
	};
}
