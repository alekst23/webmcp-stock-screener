// The parsing behind the ticker/universe filter. Pulled out of
// ChartToolbar.svelte (hotfix/marketpane-rebrand) so the header's
// TickerSearch.svelte and ChartToolbar.svelte's "Show monthly" action share
// one implementation -- the spec requires the search move location without
// changing what it does, and two copies of this regex would be exactly the
// kind of drift that guarantee is meant to rule out.

// Accepts comma- or whitespace-separated tickers, case-insensitively, and
// drops empty entries left over from stray separators.
export function parseTickers(raw: string): string[] {
	return raw
		.split(/[\s,]+/)
		.map((ticker) => ticker.trim().toUpperCase())
		.filter(Boolean);
}
