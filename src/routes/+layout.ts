// No backend session exists (see docs/plan.md's anonymous/no-auth decision) —
// workspace state lives only in the browser via localStorage, so there is
// nothing meaningful to server-render, and rendering client-only avoids the
// workspace store's singleton being shared across requests on the server.
export const ssr = false;
