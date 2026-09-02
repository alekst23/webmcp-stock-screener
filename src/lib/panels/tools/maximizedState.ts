// A trivial in-memory MaximizedPanelHandle -- not a module global, so
// each call site (a test, or T-1007-6's composition root) gets its own
// instance rather than sharing state with any other.
import type { MaximizedPanelHandle } from './layoutTools';

export function createMaximizedPanelState(): MaximizedPanelHandle {
	let maximizedId: string | null = null;
	return {
		get(): string | null {
			return maximizedId;
		},
		set(id: string | null): void {
			maximizedId = id;
		}
	};
}
