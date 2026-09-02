// The study calculation engine: bars in, named output series out, one value or
// one explicit absence per bar.
//
// The chart draws studies from this and a bounded read reports them from this,
// so both agree on every number by construction. Pure domain code -- no I/O, no
// clock, no randomness -- which is also what makes it deterministic: the same
// bars and the same parameters always produce the same output.
//
// A study's parameter metadata belongs to the catalog. Nothing here restates a
// default, a valid range or an output name; they are read from the catalog item
// on every call.

import { ENGINE_VERSION } from '../../domain/provenance';
import { builtinCatalogRegistry, type CatalogRegistry } from '../../../catalog/registry';
import type { StudyItem } from '../../../catalog/types';
import {
	averageTrueRange,
	bollingerBands,
	exponentialMovingAverage,
	macd,
	relativeStrengthIndex,
	simpleMovingAverage,
	volumeWeightedAveragePrice,
	vwapAnchorKey,
	type OutputSeries,
	type VwapAnchor
} from './studyEngine/calculators';
import { StudyInputError, StudyParameterError, UnknownStudyError } from './studyEngine/errors';
import {
	resolveParams,
	type ResolvedStudyParams,
	type StudyParamInput
} from './studyEngine/params';

export { StudyInputError, StudyParameterError, UnknownStudyError } from './studyEngine/errors';
export type { ResolvedStudyParams, StudyParamInput, StudyParamValue } from './studyEngine/params';

// The surface declares one version string; this alias is the name study code
// reads it under, so a caller wiring provenance never has to decide which of
// two version constants a study value was computed by. Bumping ENGINE_VERSION
// is required whenever study arithmetic changes -- a different seeding rule, a
// different warm-up length, a different anchor boundary, or a different
// resolution of defaults would all move a number for an unchanged input, and a
// saved setup has no other way to tell that happened. Adding a study without
// touching an existing one, or changing only a message, moves no number.
export const STUDY_ENGINE_VERSION = ENGINE_VERSION;

// A structural subset of a bar: the engine takes anything that has these
// fields, so it depends on no other chart contract.
export interface OhlcvBar {
	time: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export type StudyOutputSeries = readonly (number | null)[];

export interface StudyComputation {
	catalogItemId: string;
	// Every declared parameter, defaults included -- never a partial map.
	params: ResolvedStudyParams;
	// Keyed by the catalog's declared output names. Each series has exactly one
	// entry per input bar.
	outputs: Readonly<Record<string, StudyOutputSeries>>;
	// Leading bars for which no output has a value yet.
	warmupBars: number;
	warnings: readonly string[];
	engineVersion: string;
}

export interface StudyEngineOptions {
	registry?: CatalogRegistry;
}

type BarField = 'open' | 'high' | 'low' | 'close' | 'volume';

interface Calculator {
	// Only these fields are read, so only these are checked for usability.
	readonly fields: readonly BarField[];
	readonly readsTime: boolean;
	// Fewest bars that yield a value in every output.
	minimumBars(params: ResolvedStudyParams): number;
	// Constraints between parameters, which a per-parameter range cannot state.
	check?(item: StudyItem, params: ResolvedStudyParams): void;
	compute(bars: readonly OhlcvBar[], params: ResolvedStudyParams): Record<string, OutputSeries>;
}

function count(params: ResolvedStudyParams, name: string): number {
	return params[name] as number;
}

function column(bars: readonly OhlcvBar[], field: BarField): number[] {
	return bars.map((bar) => bar[field]);
}

const CALCULATORS = new Map<string, Calculator>([
	[
		'study.sma',
		{
			fields: ['close'],
			readsTime: false,
			minimumBars: (p) => count(p, 'length'),
			compute: (bars, p) => ({
				sma: simpleMovingAverage(column(bars, 'close'), count(p, 'length'))
			})
		}
	],
	[
		'study.ema',
		{
			fields: ['close'],
			readsTime: false,
			minimumBars: (p) => count(p, 'length'),
			compute: (bars, p) => ({
				ema: exponentialMovingAverage(column(bars, 'close'), count(p, 'length'))
			})
		}
	],
	[
		'study.atr',
		{
			fields: ['high', 'low', 'close'],
			readsTime: false,
			// The first bar has no previous close, so a length-N average of true
			// ranges needs N + 1 bars.
			minimumBars: (p) => count(p, 'length') + 1,
			compute: (bars, p) => ({
				atr: averageTrueRange(
					column(bars, 'high'),
					column(bars, 'low'),
					column(bars, 'close'),
					count(p, 'length')
				)
			})
		}
	],
	[
		'study.rsi',
		{
			fields: ['close'],
			readsTime: false,
			// Length-N averages of bar-to-bar changes need N + 1 closes.
			minimumBars: (p) => count(p, 'length') + 1,
			compute: (bars, p) => ({
				rsi: relativeStrengthIndex(column(bars, 'close'), count(p, 'length'))
			})
		}
	],
	[
		'study.macd',
		{
			fields: ['close'],
			readsTime: false,
			// The signal line is an EMA of the MACD line, which itself starts at
			// bar slow - 1.
			minimumBars: (p) => count(p, 'slow') + count(p, 'signal') - 1,
			check: (item, p) => {
				if (count(p, 'slow') <= count(p, 'fast')) {
					throw new StudyParameterError(
						item.id,
						'slow',
						p.slow,
						`greater than "fast" (${p.fast}), since MACD is the difference between the two`
					);
				}
			},
			compute: (bars, p) => {
				const series = macd(
					column(bars, 'close'),
					count(p, 'fast'),
					count(p, 'slow'),
					count(p, 'signal')
				);
				return { macd: series.macd, signal: series.signal, histogram: series.histogram };
			}
		}
	],
	[
		'study.bollinger_bands',
		{
			fields: ['close'],
			readsTime: false,
			minimumBars: (p) => count(p, 'length'),
			compute: (bars, p) => {
				const bands = bollingerBands(column(bars, 'close'), count(p, 'length'), count(p, 'stdDev'));
				return { upper: bands.upper, middle: bands.middle, lower: bands.lower };
			}
		}
	],
	[
		'study.vwap',
		{
			fields: ['high', 'low', 'close', 'volume'],
			readsTime: true,
			// VWAP restarts each span, so its very first bar already has a value.
			minimumBars: () => 1,
			compute: (bars, p) => ({
				vwap: volumeWeightedAveragePrice(
					column(bars, 'high'),
					column(bars, 'low'),
					column(bars, 'close'),
					column(bars, 'volume'),
					anchorKeys(bars, p.anchor as VwapAnchor)
				)
			})
		}
	]
]);

export const SUPPORTED_STUDY_IDS: readonly string[] = [...CALCULATORS.keys()];

export function isStudySupported(catalogItemId: string): boolean {
	return CALCULATORS.has(catalogItemId);
}

// Fully resolves a study's parameters against the catalog, defaults included.
// Throws rather than clamping; the callers that need issues as strings instead
// of an exception use `validateStudyParams`.
export function resolveStudyParams(
	catalogItemId: string,
	params: StudyParamInput = {},
	options: StudyEngineOptions = {}
): ResolvedStudyParams {
	const registry = options.registry ?? builtinCatalogRegistry;
	const { item, calculator } = lookup(registry, catalogItemId);
	const resolved = resolveParams(item, params);
	calculator.check?.(item, resolved);
	return resolved;
}

// The non-throwing form, shaped for an operation registry's `validate`.
export function validateStudyParams(
	catalogItemId: string,
	params: StudyParamInput = {},
	options: StudyEngineOptions = {}
): string[] {
	try {
		resolveStudyParams(catalogItemId, params, options);
		return [];
	} catch (error) {
		if (error instanceof StudyParameterError || error instanceof UnknownStudyError) {
			return [error.message];
		}
		throw error;
	}
}

export function computeStudy(
	bars: readonly OhlcvBar[],
	catalogItemId: string,
	params: StudyParamInput = {},
	options: StudyEngineOptions = {}
): StudyComputation {
	const registry = options.registry ?? builtinCatalogRegistry;
	const { item, calculator } = lookup(registry, catalogItemId);
	const resolved = resolveParams(item, params);
	calculator.check?.(item, resolved);
	assertBarsUsable(bars, calculator);
	const outputs = calculator.compute(bars, resolved);
	return {
		catalogItemId,
		params: resolved,
		outputs,
		warmupBars: leadingAbsentBars(outputs, bars.length),
		warnings: deriveWarnings(item, calculator.minimumBars(resolved), outputs, bars.length),
		engineVersion: STUDY_ENGINE_VERSION
	};
}

function lookup(
	registry: CatalogRegistry,
	catalogItemId: string
): { item: StudyItem; calculator: Calculator } {
	const item = registry.resolveStudy(catalogItemId);
	const calculator = CALCULATORS.get(catalogItemId);
	if (!item || !calculator) {
		throw new UnknownStudyError(catalogItemId, registry.suggestCatalogIds(catalogItemId));
	}
	return { item, calculator };
}

function assertBarsUsable(bars: readonly OhlcvBar[], calculator: Calculator): void {
	for (let i = 0; i < bars.length; i += 1) {
		const bar = bars[i] as OhlcvBar;
		for (const field of calculator.fields) {
			if (typeof bar[field] !== 'number' || !Number.isFinite(bar[field])) {
				throw new StudyInputError(i, field, bar[field], 'a finite number');
			}
		}
		if (calculator.readsTime && Number.isNaN(Date.parse(bar.time))) {
			throw new StudyInputError(i, 'time', bar.time, 'a parseable ISO 8601 timestamp');
		}
	}
}

function anchorKeys(bars: readonly OhlcvBar[], anchor: VwapAnchor): string[] {
	// Timestamps are checked before this runs, so every key resolves.
	return bars.map((bar) => vwapAnchorKey(bar.time, anchor) as string);
}

function leadingAbsentBars(outputs: Record<string, OutputSeries>, barCount: number): number {
	for (let i = 0; i < barCount; i += 1) {
		for (const series of Object.values(outputs)) {
			if (series[i] !== null && series[i] !== undefined) {
				return i;
			}
		}
	}
	return barCount;
}

// Too few bars is a warning, not a rejection: the spec's "warm-up longer than
// range" case adds the study and says it will plot nothing, so the caller can
// widen the window instead of losing the request.
function deriveWarnings(
	item: StudyItem,
	minimumBars: number,
	outputs: Record<string, OutputSeries>,
	barCount: number
): string[] {
	if (barCount === 0) {
		return [`${item.label} received no bars, so every output is absent.`];
	}
	const names = Object.keys(outputs);
	const absent = names.filter((name) => (outputs[name] as OutputSeries).every((v) => v === null));
	if (absent.length === 0) {
		return [];
	}
	const need =
		`${item.label} needs at least ${minimumBars} bars but ${barCount} ` +
		`${barCount === 1 ? 'was' : 'were'} supplied`;
	if (absent.length === names.length) {
		return [`${need}; every output is absent.`];
	}
	return [`${need}; ${absent.join(' and ')} ${absent.length === 1 ? 'is' : 'are'} absent.`];
}
