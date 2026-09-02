// SimilarityApiPort over T-1012-3's HTTP API. Mirrors
// chart/infra/httpChartSeries.ts's shape: a thin fetch wrapper, wire-shape
// normalization at the boundary, transport failures wrapped rather than
// leaked.
import type { InstrumentAssetType } from '../../chart/domain/instrument';
import type {
	FeatureFamily,
	FeatureWeightSet,
	MarketDataProvenance,
	Normalization,
	SearchScope,
	SimilarityCandidate,
	SimilarityExplanation,
	SimilarityRun
} from '../domain/contract';
import {
	SimilarityApiError,
	type SimilarityApiPort,
	type SimilaritySearchRequest
} from '../domain/apiPort';

export interface HttpSimilarityApiConfig {
	baseUrl: string;
	fetchImpl?: typeof fetch;
}

// The backend nests a FeatureWeightSet's own `weights` field one level in
// (pydantic serializes the wrapper model, not a bare dict) -- confirmed by
// inspecting FeatureWeightSet.model_dump_json() directly, not assumed.
function fromWireWeights(wire: unknown): FeatureWeightSet {
	const inner = (wire as { weights?: unknown } | undefined)?.weights;
	return (inner ?? {}) as FeatureWeightSet;
}

function fromWireNormalization(wire: unknown): Normalization {
	const w = wire as { mode?: unknown; anchor?: unknown };
	return { mode: w.mode as Normalization['mode'], anchor: w.anchor as Normalization['anchor'] };
}

function fromWireProvenance(wire: unknown): MarketDataProvenance {
	const w = wire as Record<string, unknown>;
	return {
		asOf: w.as_of,
		sourceId: w.source_id,
		sourceLabel: w.source_label,
		liveness: w.liveness,
		...(w.delay_seconds !== undefined ? { delaySeconds: w.delay_seconds } : {}),
		timezone: w.timezone,
		...(w.currency !== undefined ? { currency: w.currency } : {}),
		...(w.price_adjustment !== undefined ? { priceAdjustment: w.price_adjustment } : {}),
		engineVersion: w.engine_version
	} as MarketDataProvenance;
}

function fromWireCandidate(wire: unknown): SimilarityCandidate {
	const w = wire as Record<string, unknown>;
	const instrument = w.instrument as Record<string, unknown>;
	const window = w.window as Record<string, unknown>;
	return {
		candidateId: w.candidate_id as string,
		instrument: {
			instrumentId: instrument.instrument_id as string,
			symbol: instrument.symbol as string,
			// The Python-side InstrumentRef (domain/models/similarity.py) allows
			// null exchange/asset_type; the TS InstrumentRef (reused from
			// chart/domain/instrument.ts) does not. 'equity' matches every
			// ticker this program's mock/real panel currently carries; an
			// unknown exchange is stated as such rather than guessed.
			exchange: (instrument.exchange as string | null) ?? 'UNKNOWN',
			assetType: (instrument.asset_type as InstrumentAssetType | null) ?? 'equity'
		},
		window: {
			start: window.start as string,
			end: window.end as string,
			timeframe: window.timeframe as string
		},
		score: w.score as number,
		perFamilySimilarity: w.per_family_similarity as Partial<Record<FeatureFamily, number>>,
		unavailableFamilies: (w.unavailable_families ?? []) as FeatureFamily[]
	};
}

function fromWireRun(wire: unknown): SimilarityRun {
	const w = wire as Record<string, unknown>;
	return {
		runId: w.run_id as string,
		referenceSetupId: w.reference_setup_id as string,
		scope: w.scope as SearchScope,
		weights: fromWireWeights(w.weights),
		normalization: fromWireNormalization(w.normalization),
		provenance: fromWireProvenance(w.provenance),
		candidates: (w.candidates as unknown[]).map(fromWireCandidate),
		warnings: (w.warnings ?? []) as string[]
	};
}

function fromWireExplanation(wire: unknown): SimilarityExplanation {
	const w = wire as Record<string, unknown>;
	return {
		candidateId: w.candidate_id as string,
		overallScore: w.overall_score as number,
		weightApplied: w.weight_applied as Partial<Record<FeatureFamily, number>>,
		perFamilySimilarity: w.per_family_similarity as Partial<Record<FeatureFamily, number>>,
		contributions: w.contributions as Partial<Record<FeatureFamily, number>>,
		unavailableFamilies: (w.unavailable_families ?? []) as FeatureFamily[]
	};
}

// `notFoundReason` names what a 404 means for the endpoint being called
// (search never 404s; get-run/explain do). A 422 is always a validation or
// reference-availability failure -- the route can't distinguish those by
// status code (both are client errors about the request), so the message
// text (already actionable per T-1012-3 AC5-AC7) is what actually
// disambiguates them, not the reason field.
async function toApiError(
	response: Response,
	notFoundReason: SimilarityApiError['reason']
): Promise<SimilarityApiError> {
	let message = `Request failed with ${response.status} ${response.statusText}`;
	try {
		const body = await response.json();
		const detail = body?.detail;
		message = typeof detail === 'object' && detail !== null ? detail.message : (detail ?? message);
	} catch {
		// Body wasn't JSON; keep the status-line message.
	}
	const reason: SimilarityApiError['reason'] =
		response.status === 404
			? notFoundReason
			: response.status === 422
				? 'validation'
				: 'source_unavailable';
	return new SimilarityApiError(reason, String(message));
}

export function createHttpSimilarityApi(config: HttpSimilarityApiConfig): SimilarityApiPort {
	const doFetch = config.fetchImpl ?? fetch;

	async function post(path: string, body: unknown): Promise<unknown> {
		let response: Response;
		try {
			response = await doFetch(`${config.baseUrl}${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
		} catch (err) {
			throw new SimilarityApiError(
				'source_unavailable',
				'The similarity API could not be reached.',
				{
					cause: err
				}
			);
		}
		if (!response.ok) {
			throw await toApiError(response, 'reference_unavailable');
		}
		return readJson(response);
	}

	async function get(path: string, fallbackReason: SimilarityApiError['reason']): Promise<unknown> {
		let response: Response;
		try {
			response = await doFetch(`${config.baseUrl}${path}`);
		} catch (err) {
			throw new SimilarityApiError(
				'source_unavailable',
				'The similarity API could not be reached.',
				{
					cause: err
				}
			);
		}
		if (!response.ok) {
			throw await toApiError(response, fallbackReason);
		}
		return readJson(response);
	}

	async function readJson(response: Response): Promise<unknown> {
		try {
			return await response.json();
		} catch (err) {
			throw new SimilarityApiError(
				'malformed_response',
				'The similarity API returned a body that could not be read.',
				{ cause: err }
			);
		}
	}

	return {
		async search(request: SimilaritySearchRequest): Promise<SimilarityRun> {
			const body = await post('/api/similarity/search', {
				instrument_id: request.instrumentId,
				window: request.window,
				scope: request.scope,
				...(request.weights !== undefined ? { weights: request.weights } : {}),
				...(request.normalization !== undefined
					? {
							normalization: {
								mode: request.normalization.mode,
								anchor: request.normalization.anchor
							}
						}
					: {}),
				...(request.limit !== undefined ? { limit: request.limit } : {}),
				...(request.minScore !== undefined ? { min_score: request.minScore } : {}),
				...(request.referenceSetupId !== undefined
					? { reference_setup_id: request.referenceSetupId }
					: {})
			});
			return fromWireRun(body);
		},

		async getRun(runId: string): Promise<SimilarityRun> {
			// SimilarityRunPage is a strict superset of a full run (paged
			// candidates plus total_candidates/offset/next_offset) -- fromWireRun
			// reads the fields it needs and ignores the rest, so no separate
			// parser is needed.
			const body = await get(`/api/similarity/runs/${encodeURIComponent(runId)}`, 'not_found_run');
			return fromWireRun(body);
		},

		async explain(runId: string, candidateId: string): Promise<SimilarityExplanation> {
			const body = await get(
				`/api/similarity/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}/explanation`,
				'not_found_candidate'
			);
			return fromWireExplanation(body);
		}
	};
}
