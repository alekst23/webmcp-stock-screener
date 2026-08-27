# WebMCP: A Technical Guide

Research date: 2026-08-26. WebMCP is an early-stage, actively-changing draft —
verify details against the spec before relying on them for implementation.

Primary source: [webmachinelearning.github.io/webmcp](https://webmachinelearning.github.io/webmcp/)
(W3C Web Machine Learning Community Group, Draft Community Group Report — not
a W3C Standard, not on the Standards Track).

## 1. What Problem It Solves

Today, AI agents interact with web apps by scraping the DOM, taking
screenshots, and simulating clicks — fragile, slow, and error-prone, since
the agent is guessing at a UI built for humans. WebMCP lets a page **declare
structured, callable tools** (name, description, JSON-schema input, an
`execute` function) so an agent calls a well-defined function instead of
reverse-engineering the page.

Explicit non-goals of the spec: headless browsing, fully autonomous
workflows with no human present, and replacing backend integration
protocols. WebMCP is for **cooperative human + agent use in an open browser
tab**, not unattended automation.

## 2. Core Concepts / Architecture

1. The page registers tools.
2. The agent (built into the browser, or a browser extension) discovers
   available tools.
3. The agent invokes a tool with structured arguments.
4. The page's own `execute` callback runs **in-page**, with full access to
   page state, the user's authenticated session, and existing client-side
   logic.
5. A structured result is returned to the agent.

A `toolchange` event lets a page update its tool list dynamically — e.g.
exposing more tools once the user logs in.

### Relationship to MCP (Anthropic's Model Context Protocol)

The spec describes WebMCP as sharing "a common vocabulary with MCP (tools,
schemas, parameters)" while being "purpose-built for browsers." It is not a
transport-level extension of MCP — it's a parallel, client-safe design:

| | MCP | WebMCP |
|---|---|---|
| Runs | server-to-client | client-side, in-tab |
| Availability | can be always-on | requires an open tab |
| Autonomy | can run unattended | human-in-the-loop by default |
| Session | its own auth | reuses the user's authenticated browser session |

A site can reasonably offer both: an MCP server for backend/autonomous
integrations, and WebMCP tools for in-browser, human-present sessions.

## 3. API Surface

The authoritative namespace, per the current spec, is **`document.modelContext`**
(not `navigator.modelContext` — several third-party tutorials use that name,
which appears to be stale or from an earlier draft; trust `document.modelContext`).

```webidl
Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options)
Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options)
Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject, optional ModelContextExecuteToolOptions options)

dictionary ModelContextTool {
  required DOMString name;
  USVString title;
  required DOMString description;
  object inputSchema;
  required ToolExecuteCallback execute;   // (inputObject, {signal}) => Promise<any>
  ToolAnnotations annotations;
}
```

### Imperative registration example

```js
await document.modelContext.registerTool({
  name: "addTodo",
  description: "Add a task to the user's to-do list",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The task description" },
      priority: { type: "string", enum: ["low", "medium", "high"] }
    },
    required: ["text"]
  },
  execute: async ({ text, priority = "medium" }) => {
    todoApp.addItem({ id: Date.now(), text, priority });
    todoApp.renderList();
    return { content: [{ type: "text", text: `Added "${text}"` }] };
  }
});
```

### Declarative registration (existing forms)

For simple existing `<form>` elements, HTML attributes (`toolname`,
`tooldescription`, `toolautosubmit`, `toolparamdescription`,
`toolparamtitle`) let the browser auto-derive a JSON schema without writing
JS. **Status is unclear** — one source shows it working in the early
preview, another describes it as a deferred/TODO idea. Treat as unstable
and verify at implementation time.

## 4. Browser / Runtime Support

- **Not shipped in stable Chrome.** Available only in Chrome Canary
  (sources say 146+), behind a flag — the exact flag name is inconsistent
  across sources (`#enable-webmcp-for-testing` vs. `#enable-webmcp-testing`);
  check `chrome://flags` directly rather than trusting either string.
- Chrome's official announcement ([developer.chrome.com/blog/webmcp-epp](https://developer.chrome.com/blog/webmcp-epp))
  confirms this is an **early preview / signup-gated program**, not general
  availability.
- A `navigator.modelContextTesting` surface exists for automated testing
  (`getTools()`, `executeTool()`, `provideContext()`, `clearContext()`) —
  explicitly dev-only, not for production use.
- No other browser has a known implementation yet — this is a single-vendor,
  moving target right now.
- Feature-detect before using it:
  ```js
  if ('modelContext' in document) {
    // register tools
  }
  ```

## 5. Security / Permissions Model

- **`[SecureContext]`** — HTTPS only.
- **Same-origin by default.** Tools are exposed only to same-origin
  documents and built-in browser agents. Cross-origin sharing requires
  explicit opt-in via `exposedTo: ["https://partner.example"]`, or iframe
  `allow="tools"` / a `Permissions-Policy: tools=()` header. Note: the
  spec's security section also states iframes are excluded from tool
  exposure by default to preserve the origin boundary — this is a point
  worth re-checking against the live spec before relying on cross-frame
  behavior.
- **Human-in-the-loop by default.** For declarative forms, the agent can
  fill fields, but a human must click Submit unless `toolautosubmit` is
  set — which should only be used on read-only/non-destructive tools.
- An `agentInvoked` flag on submit events lets the page distinguish
  agent-triggered from human-triggered submissions (useful for rate
  limiting or requiring extra confirmation).
- Section 6 of the spec (Security & Privacy) covers: prompt injection via
  tool metadata/descriptions, output-injection attacks, misrepresentation
  of user intent, privacy leakage via over-parameterized schemas,
  same-origin boundary violations, and private-browsing interactions.
  Suggested mitigations: input-length limits, an "untrusted" annotation on
  tool responses, and confirmation flows for destructive actions (e.g.
  requiring a typed confirmation phrase before a delete executes).
- `AbortSignal` support lets a user cancel an in-flight, agent-invoked tool
  call.

## 6. Adding WebMCP to an Existing App

1. Feature-detect: `if ('modelContext' in document) { ... }`.
2. For simple existing forms, try the declarative `tool*` attributes first
   — minimal diff, schema is auto-derived.
3. For anything dynamic (API calls, computed data, non-form actions), call
   `document.modelContext.registerTool()` directly, wrapping existing
   client-side functions inside `execute`.
4. Register/unregister tools conditionally — e.g. only expose
   `viewOrderHistory` after login, and call `unregisterTool` on logout.
5. Add confirmation/guard logic for destructive tools, and give the human
   visual affordances so they can see what the agent is doing (a
   `toolactivated` / `toolcancel` event pair, and a
   `:tool-form-active` CSS pseudo-class for highlighting agent-filled
   fields, per one tutorial's pattern).
6. **Validate all agent-supplied input server-side too.** Treat it exactly
   like any other untrusted form input — the client-side schema is not a
   security boundary.

## 7. Limitations / Open Questions

Per the spec's own tracked issues:

- No site-wide tool-discovery mechanism yet (no manifest file or
  well-known URL) — discovery is currently "the agent is on this page."
- The declarative-vs-imperative story is still settling and inconsistent
  across current docs, likely because the preview is actively changing.
- Open design questions: multimodal I/O (audio/image/streams), streaming
  for long-running tool calls, enforcement of schema validation, a
  higher-level "skills" abstraction over multiple tools, progress
  reporting for batch operations, Service Worker–based background tool
  discovery, and default tool visibility rules for iframes vs. top-level
  documents.
- Only one implementation exists today (Chrome, early preview, flagged) —
  no cross-browser support, so building against this now means building
  against a moving target.

## 8. Sources

- Spec (authoritative): https://webmachinelearning.github.io/webmcp/
- Explainer/README: https://github.com/webmachinelearning/webmcp
- Chrome early preview announcement: https://developer.chrome.com/blog/webmcp-epp
- W3C Web Machine Learning Community Group: https://www.w3.org/groups/cg/webmachinelearning/
- Curated list: https://github.com/webmachinelearning/awesome-webmcp
- Google Chrome Labs tooling: https://github.com/GoogleChromeLabs/webmcp-tools
- Alternate/reference implementation (MCP-B): https://github.com/WebMCP-org
- Third-party writeups (verify naming against the spec — some may be
  stale): [webfuse cheat sheet](https://www.webfuse.com/webmcp-cheat-sheet),
  [DataCamp tutorial](https://www.datacamp.com/tutorial/webmcp-tutorial),
  [Zuplo overview](https://zuplo.com/blog/what-is-webmcp)
