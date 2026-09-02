<script lang="ts">
	// AC6: as_of, source, live/delayed status, timezone, currency, price
	// adjustment policy, fundamentals reporting period, and calculation-engine
	// version, all reachable without leaving the panel -- a collapsed
	// disclosure right in the panel body, not a separate route or dialog.
	import type { MarketDataProvenance } from '../../workbench/domain/provenance';

	let { provenance }: { provenance: MarketDataProvenance } = $props();

	function livenessLabel(p: MarketDataProvenance): string {
		if (p.liveness === 'delayed') {
			return `Delayed by ${p.delaySeconds}s`;
		}
		return { live: 'Live', end_of_day: 'End of day', historical: 'Historical', static: 'Static' }[
			p.liveness
		];
	}

	function reportingPeriodLabel(p: MarketDataProvenance): string | null {
		const period = p.reportingPeriod;
		if (!period) {
			return null;
		}
		const basis = {
			point_in_time: 'Point in time',
			trailing_twelve_months: 'Trailing twelve months',
			fiscal_quarter: `FY${period.fiscalYear} Q${period.fiscalQuarter ?? '?'}`,
			fiscal_year: `FY${period.fiscalYear}`
		}[period.basis];
		return `${basis}, ending ${period.periodEnd}`;
	}
</script>

<details class="provenance">
	<summary>Data as of {provenance.asOf}</summary>
	<dl>
		<dt>Source</dt>
		<dd>{provenance.sourceLabel}</dd>
		<dt>Status</dt>
		<dd>{livenessLabel(provenance)}</dd>
		<dt>Timezone</dt>
		<dd>{provenance.timezone}</dd>
		{#if provenance.currency}
			<dt>Currency</dt>
			<dd>{provenance.currency}</dd>
		{/if}
		{#if provenance.priceAdjustment}
			<dt>Price adjustment</dt>
			<dd>{provenance.priceAdjustment}</dd>
		{/if}
		{#if reportingPeriodLabel(provenance)}
			<dt>Fundamentals period</dt>
			<dd>{reportingPeriodLabel(provenance)}</dd>
		{/if}
		<dt>Engine version</dt>
		<dd>{provenance.engineVersion}</dd>
	</dl>
</details>

<style>
	.provenance {
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	summary {
		cursor: pointer;
		color: var(--text-secondary);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-xs) var(--space-sm);
		margin: var(--space-xs) 0 0;
	}

	dt {
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
	}

	dd {
		margin: 0;
	}
</style>
