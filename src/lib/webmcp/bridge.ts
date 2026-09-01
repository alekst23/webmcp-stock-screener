import type {
	ModelContext,
	ModelContextToolDescriptor,
	RegisteredToolInfo,
	ToolResult
} from './types';

// `document.modelContext` ships in almost no browser today, and which ones
// have it is not knowable from inside the page: a flag, an extension, or a
// future release can add it at any moment, and an extension can install it
// after this script has already run. So this module stops asking whether the
// browser has a bridge and guarantees there is one -- the browser's if it
// supplied one, otherwise the page's own. Registration therefore always has
// somewhere to land, and nothing downstream branches on browser support.
//
// The page-provided bridge is not a lesser fallback. Any agent that can
// evaluate JS in the tab -- which is most of them -- can call getTools() and
// executeTool() on it and drive the full tool surface.

// The tools this page registered when the browser supplied no bridge of its
// own. Kept at module scope so repeated mounts share one registry, exactly as
// they would share a browser-supplied `document.modelContext`.
let pageContext: ModelContext | undefined;

// Set once `document.modelContext` is this module's accessor rather than a
// plain property, so a second call re-uses the accessor instead of clobbering
// a bridge that arrived through it.
let accessorInstalled = false;

// Whatever was last assigned to `document.modelContext` from outside -- a
// late-injecting extension, or a test installing a fake.
let assignedContext: ModelContext | undefined;

const replacementListeners = new Set<(mc: ModelContext) => void>();

// Held as stable references so syncInstalledState can recognise this module's
// own accessor on the document and tell it apart from anyone else's.
const pageContextGetter = (): ModelContext | undefined => assignedContext ?? pageContext;

const pageContextSetter = (next: ModelContext | undefined): void => {
	assignedContext = next;
	if (next && next !== pageContext) {
		for (const listener of replacementListeners) {
			listener(next);
		}
	}
};

// The accessor this module installs can be removed or redefined by something
// else -- another script claiming the property, a test tearing down the
// document. Module state that still describes an accessor which is no longer
// on the document would strand this page's tools on an object nothing can
// reach, and would keep notifying listeners that are no longer wired to
// anything, so drop all of it and start clean instead.
function syncInstalledState(): void {
	if (!accessorInstalled) {
		return;
	}
	const descriptor = Object.getOwnPropertyDescriptor(document, 'modelContext');
	if (descriptor?.get === pageContextGetter) {
		return;
	}
	accessorInstalled = false;
	pageContext = undefined;
	assignedContext = undefined;
	replacementListeners.clear();
}

// Fires when a bridge arrives after this module already handed out the page's
// own. The tools registered so far are on the old object and the new one has
// never heard of them, so listeners re-register rather than assume a handover.
// Returns an unsubscribe.
export function onBridgeReplaced(listener: (mc: ModelContext) => void): () => void {
	replacementListeners.add(listener);
	return () => {
		replacementListeners.delete(listener);
	};
}

// A complete in-page implementation of the draft `document.modelContext`
// surface. `executeTool` takes a bare name as well as the spec's tool object,
// because the caller that needs it most is an agent typing a one-liner into
// an evaluate-JS tool.
export function createPageModelContext(): ModelContext {
	const tools = new Map<string, ModelContextToolDescriptor>();
	return {
		registerTool: async (tool: ModelContextToolDescriptor): Promise<void> => {
			tools.set(tool.name, tool);
		},
		unregisterTool: async (name: string): Promise<void> => {
			tools.delete(name);
		},
		getTools: async (): Promise<RegisteredToolInfo[]> =>
			[...tools.values()].map(({ name, description, inputSchema }) => ({
				name,
				description,
				inputSchema
			})),
		executeTool: async (tool: string | { name: string }, input?: unknown): Promise<ToolResult> => {
			const name = typeof tool === 'string' ? tool : tool.name;
			const descriptor = tools.get(name);
			if (!descriptor) {
				throw new Error(`Unknown WebMCP tool: ${name}`);
			}
			return descriptor.execute(input ?? {});
		}
	};
}

// Returns the bridge to register against, installing the page's own if the
// browser supplied none. Never returns undefined -- that is the whole point.
export function ensureModelContext(): ModelContext {
	syncInstalledState();
	const supplied = document.modelContext;
	if (supplied) {
		return supplied;
	}
	if (!pageContext) {
		pageContext = createPageModelContext();
	}
	if (!accessorInstalled) {
		// An accessor rather than a plain assignment, so a bridge injected later
		// is observed instead of silently replacing the object this page is
		// still registering against. Defined only when the browser supplied
		// nothing, so a native `modelContext` is never shadowed.
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			enumerable: true,
			get: pageContextGetter,
			set: pageContextSetter
		});
		accessorInstalled = true;
	}
	return assignedContext ?? pageContext;
}
