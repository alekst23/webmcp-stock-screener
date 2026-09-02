# Terminal UI Theme — Technical Design

Implements [spec.md](spec.md). This file documents code; behavior stays in
the spec.

## Solution approach

The app has no theme layer at all today: no global stylesheet, no CSS custom
properties anywhere in `src/`, and roughly forty hardcoded light-theme hex
literals spread across ten per-component `<style>` blocks. There is nothing
to extend, so this change introduces the layer and then converts every
component onto it.

Three modules carry the design, all under `src/lib/theme/`:

1. **`tokens.ts`** — the palette and scales as typed constants, the single
   source of truth. It also emits the `:root` custom-property block, so the
   values the tests measure and the values the browser paints cannot drift
   apart. Nothing else in the app is allowed to name a colour.
2. **`contrast.ts`** — pure sRGB relative-luminance and contrast-ratio
   functions. This is what turns "legible" from a judgement into an
   assertion; the palette's compliance is a test result, not an opinion.
3. **`paletteGuard.ts`** — scans component source for raw colour literals.
   This is the only thing that keeps the token layer from eroding the next
   time someone needs "just one more grey", and it follows the existing
   `snapshotGuard.ts` precedent of extracting a checkable rule into a plain
   function so it can be unit-tested without mounting anything.

The global stylesheet is injected once from `+layout.svelte`, which is
currently an 11-line file that renders nothing but a favicon link — the
natural and only shared ancestor of every route. `app.html` declares
`color-scheme: dark` and paints the app background on `html`, which is what
makes native scrollbars and form controls render dark and prevents a
white first paint before the SPA hydrates.

`AppShell.svelte` provides the three regions the spec calls for (top bar,
work area, log region) as a layout component with snippet props. `/` composes
through it; `/dev` and `/spike` inherit the theme through the global
stylesheet without adopting the shell, since neither is part of the
researcher-facing surface.

Component conversion is mechanical: each `<style>` block's literals become
`var(--…)` references. `PriceChart.svelte` needs slightly more care than the
rest because its colours are SVG presentation attributes and an inline
gradient, not just CSS declarations. Two idioms every component was spelling
out by hand — the panel card and the outlined control — live as global classes
in `+layout.svelte` alongside the other shared element styling, so a new
panel or button cannot invent its own padding.

**Deliberately not done:** no light theme, no theme toggle, no persisted
preference — a second theme would double the contrast surface for a product
that has one intended viewing context. No new dependency: the codebase has
no component-testing library and this change does not add one (see Testing).

**Known cost, accepted:** `legacy-surface-cutover/spec.md` plans to delete
most of the components being restyled here. The token and contrast modules
survive that cutover; the per-component CSS does not. Styling the surface
that exists today is worth that, but it should not be a surprise later.

## Contracts

### `src/lib/theme/tokens.ts`

| Export | Type | Purpose |
|--------|------|---------|
| `SemanticRole` | union type | Every named colour slot in the interface. The full set of things a component may refer to. |
| `ThemeTokens` | interface | `colors: Record<SemanticRole, string>`, plus `space`, `radius`, `fontSize`, `fontFamily`, `tracking` scales. |
| `theme` | `ThemeTokens` | The single instance. The only place a colour literal may appear. |
| `themeCss(t?: ThemeTokens): string` | function | Renders the tokens as a `:root { --… }` declaration block for injection into `<head>`. |
| `cssVarName(role: SemanticRole): string` | function | The custom-property name for a role, so the emitter and any consumer agree on one spelling. |

Semantic roles, grouped by what they mean rather than what they look like:

| Group | Roles |
|-------|-------|
| Grounds | `bgApp`, `bgPanel`, `bgElevated`, `bgHover` |
| Lines | `border`, `borderStrong`, `separator` (decorative, exempt from the contrast floor) |
| Text | `textPrimary`, `textSecondary`, `textMuted`, `textOnAccent` |
| Interactive | `accent`, `accentHover`, `focusRing` |
| Status | `warning`, `synthetic`, `syntheticBg`, `degraded`, `degradedBg`, `error`, `errorBg` |
| Actors | `actorHuman`, `actorAgent` |
| Chart | `chartLine`, `chartFillFrom`, `chartFillTo`, `chartGrid`, `chartAxis`, `chartAnchor`, `chartCrosshair`, `chartTooltipBg`, `chartTooltipText` |

`synthetic`, `degraded`, and `error` are separate roles rather than aliases
of `warning` precisely because the spec requires no two of them render in the
same colour.

`tracking` carries two treatments, not five hand-tuned letter-spacings:
`label` is the uppercase micro-label used for every section and control name,
`heading` the much subtler widening on real headings. A role is only in the
palette if something renders it -- a colour nothing references is a
documented lie about what the interface uses.

### `src/lib/theme/contrast.ts`

| Export | Signature | Purpose |
|--------|-----------|---------|
| `relativeLuminance` | `(hex: string) => number` | WCAG 2.x relative luminance of an sRGB colour. |
| `contrastRatio` | `(a: string, b: string) => number` | WCAG contrast ratio; order-independent, range 1–21. |
| `meetsAA` | `(fg: string, bg: string) => boolean` | `contrastRatio >= 4.5` — body text. |
| `meetsAALarge` | `(fg: string, bg: string) => boolean` | `contrastRatio >= 3.0` — large text and meaningful non-text. |

Both take `#rgb` / `#rrggbb`; invalid input throws rather than returning a
misleading number, so a malformed token fails loudly in the test that reads it.

### `src/lib/theme/paletteGuard.ts`

| Export | Signature | Purpose |
|--------|-----------|---------|
| `ColourLiteral` | interface | `{ file: string; line: number; literal: string }` |
| `findColourLiterals` | `(source: string, file: string) => ColourLiteral[]` | Every colour literal in one file's source: hex, any CSS colour function, and the CSS named colours. |

Pure over a string so it is testable without touching the filesystem; the
test supplies the file walk and names the glob it walks.

A named colour counts only in a declaration value or an SVG paint attribute,
with comments masked out, so `background: white` is caught while the word
"red" in prose, a `silver-badge` class, and `white-space` are not.

### `src/lib/shell/AppShell.svelte`

Layout only — no store access, no fetching, no business logic.

| Prop | Type | Purpose |
|------|------|---------|
| `topBar` | `Snippet` | Identity and session status (the tool counts live here). |
| `children` | `Snippet` | The work area. |
| `log` | `Snippet` | The bottom region, kept structurally last. |

## Testing

The codebase mounts no components in tests — there is no
`@testing-library/svelte`, and the house convention (stated in
`snapshotGuard.ts`) is that logic lives in plain `.ts` functions tested
without mounting, while thin Svelte wiring goes untested. This change keeps
that convention rather than introducing a component-testing dependency for a
CSS change.

That leaves the spec invariants with no natural home — the activity log's
position, the agent context comment, the tool counts, and the fact that the
palette reaches the document at all — none of which any existing test covers
and all of which a restyle could break silently. They are guarded by reading
component source and asserting structure. A source assertion is a blunt
instrument, and it is chosen deliberately over the alternative of leaving
documented, agent-facing guarantees unprotected during exactly the change
most likely to disturb them.

Each guard asserts against the file that actually decides the outcome, which
is not always the file that looks responsible: the log's position comes from
`AppShell.svelte`'s `<footer>`, not from where `+page.svelte` declares the
snippet, because snippet declarations are order-independent. Region and
snippet names are read out of the source rather than spelled into the test,
so renaming a prop stays a refactor.
