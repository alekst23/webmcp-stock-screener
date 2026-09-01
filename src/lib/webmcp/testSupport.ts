import type { ModelContext, ModelContextToolDescriptor } from './types';

// Shared across register.test.ts and session.test.ts, mirroring
// workspace/testSupport.ts's convention, so the two files cannot drift into
// disagreeing about what a bridge does.
export interface FakeBridge {
	mc: ModelContext;
	registered: Map<string, ModelContextToolDescriptor>;
	registerCalls: string[];
	unregisterCalls: string[];
	// Names registered while an identical name was already live on the bridge.
	// `registered` is keyed by name, so a real double-registration collapses
	// into one entry and is otherwise invisible -- which is exactly what made
	// the remount test unable to fail.
	duplicateRegistrations: string[];
}

export interface FakeBridgeOptions {
	onRegister?: (name: string) => void;
	onUnregister?: (name: string) => void;
	// types.ts makes ModelContext.unregisterTool optional, and a bridge without
	// it can never retire anything. Defaults to a bridge that has it.
	supportsUnregister?: boolean;
}

export function fakeBridge(options: FakeBridgeOptions = {}): FakeBridge {
	const registered = new Map<string, ModelContextToolDescriptor>();
	const registerCalls: string[] = [];
	const unregisterCalls: string[] = [];
	const duplicateRegistrations: string[] = [];
	const mc: ModelContext = {
		registerTool: async (tool) => {
			options.onRegister?.(tool.name);
			if (registered.has(tool.name)) {
				duplicateRegistrations.push(tool.name);
			}
			registerCalls.push(tool.name);
			registered.set(tool.name, tool);
		}
	};
	if (options.supportsUnregister !== false) {
		mc.unregisterTool = async (name) => {
			options.onUnregister?.(name);
			unregisterCalls.push(name);
			registered.delete(name);
		};
	}
	return { mc, registered, registerCalls, unregisterCalls, duplicateRegistrations };
}
