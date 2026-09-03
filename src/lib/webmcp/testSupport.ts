import type { ModelContext } from './types';

// Removes whatever `document.modelContext` currently is -- a fake bridge, or
// the accessor bridge.ts installs when the browser supplies none. Deleting
// the property (rather than assigning undefined) is what bridge.ts recognises
// as its accessor being gone, so the next ensureModelContext() starts from a
// clean registry with no listeners left over from the previous test.
//
// FakeBridge/fakeBridge (T-1015-5: register.ts's own richer double, tracking
// register/unregister calls and duplicate-registration detection for the
// generation-ownership tests) retired with register.test.ts/session.test.ts
// -- this file's only surviving consumer, newSurfaceSession.test.ts, defines
// its own minimal fake and needs only this reset helper.
export function clearModelContext(): void {
	delete (document as { modelContext?: ModelContext }).modelContext;
}
