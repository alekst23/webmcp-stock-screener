# Terminal UI Theme — Product Spec

**Hotfix:** true

## Intent

The workbench currently presents as a centered 720px document on a white
ground — a page, not an instrument. A researcher watching price action for
long sessions wants the app to read like a trading terminal: dark, dense,
and quiet enough that the data is the only thing that draws the eye. This
feature establishes one visual treatment across every route, applied to the
content that exists today. Done looks like: opening the app and seeing a
dark, high-density surface where every status the app already reports is
still legible at a glance.

## Preconditions

- The app is a client-only SPA; there is no server-rendered theme and no
  user account to store a theme preference against.
- Every behavior asserted by
  [Pattern Research Workbench](../pattern-research-workbench/spec.md)
  continues to hold. This feature changes presentation only — no tool, no
  workspace operation, and no agent-facing contract changes.

## Features

1. **One dark treatment everywhere**: every route shares a single dark,
   high-density visual treatment.
2. **Legible by measurement**: text and UI chrome meet a stated contrast
   floor rather than being judged by eye.
3. **Status stays distinguishable**: every state the app already
   distinguishes visually remains distinguishable on the dark ground.
4. **A persistent shell**: the workbench is laid out in stable regions
   rather than one centered column.

## Behavioral Specifications

### One dark treatment everywhere

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | any route in the app (`/`, `/dev`, `/spike`) | the researcher loads it | it renders on the dark ground with the same palette, type scale, and density as every other route — no route falls back to the browser's default light styling |
| Native controls match | a route containing form controls (inputs, buttons) | the page renders | browser-native chrome (scrollbars, form-control defaults, focus rings) renders in the dark treatment rather than as light-theme defaults on a dark page |
| No flash of light | the app is loaded fresh | the first paint occurs | the dark ground is painted from the first frame; the researcher never sees a white page that then turns dark |

### Legible by measurement

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Body text | any body-level text colour paired with the background it is rendered on | the pairing is measured | its contrast ratio is at least 4.5:1 |
| Meaningful non-text and large text | any colour that carries meaning without text — an interactive control's boundary, a focus indicator, a state indicator — or any large-text colour, paired with its background | the pairing is measured | its contrast ratio is at least 3:1 |
| Decorative separators are exempt | a rule or divider that only groups content, where nothing is conveyed by its presence alone | it is measured | it is held to no contrast floor; it may sit quietly below 3:1 |
| Enforced, not asserted | a colour is introduced anywhere in the interface | the interface is checked | that colour is drawn from the named palette rather than specified ad hoc at the point of use, so the contrast floor above covers it |

### Status stays distinguishable

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Synthetic data | the backend is serving a synthetic (mock) price panel | the researcher looks at the panel-status line | it still does not read like real market data at a glance, and remains legible against the dark ground |
| Degraded bridge | the WebMCP bridge is unavailable or failed to connect | the researcher looks at the header | it still does not read like a working bridge at a glance, and remains legible against the dark ground |
| Errors | an action fails and reports an error | the researcher looks at the error text | it is visually distinct from ordinary body text and from the synthetic-data and degraded-bridge treatments |
| Distinct from each other | the synthetic-data, degraded-bridge, and error treatments | they are compared | no two of them are rendered in the same colour, so one state can never be mistaken for another |
| Actor attribution | an activity log containing both human and agent entries | the researcher scans the log | human and agent entries remain distinguishable from each other, as they were before |

### A persistent shell

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Stable regions | the workbench at any amount of workspace content | the researcher looks at the page | it is laid out in stable regions — a top bar carrying identity and session status, a work area, and the activity log — rather than one centered column of stacked blocks |
| Log stays at the bottom | the page renders any amount of workspace content | the researcher looks for the activity log | it still appears at the bottom, below all panels and the focus chart |
| Tool counts stay in the header | the page loads | the researcher looks at the top bar | both counts are still there: the number of tools defined and the number currently callable |
| Agent context survives | the page loads | an agent reads the page's HTML source | the agent-facing context comment is still present and still states plainly whether the tools are callable |
| Navigation is honest | the researcher looks at the top bar | they consider where they can go | it offers only destinations that exist; it does not present controls for capabilities the app does not have |
| Density does not cost reachability | any interactive control in the denser layout | the researcher operates it with a pointer or keyboard | it remains large enough to hit and shows a visible focus state when focused |

## Non-Goals

- A light theme, or any runtime theme switching. There is one treatment.
- A user-selectable or persisted theme preference.
- Any new panel kind, screener, watchlist, alert, or results table. This
  feature restyles the surface that exists; it does not add capability.
- Candlestick rendering or new chart studies (moving averages, Bollinger
  bands, RSI, MACD). The existing line/area chart is restyled, not replaced.
- Responsive breakpoint behavior beyond keeping the existing layout usable
  at small widths.
- Reordering or resizing panels (already a Non-Goal of the workbench spec).

*Implemented by:* hotfix/terminal-ui-theme
