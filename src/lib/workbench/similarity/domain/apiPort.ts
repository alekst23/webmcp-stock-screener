// The browser-to-backend port for T-1012-3's similarity HTTP API. Narrow on
// purpose, mirroring chart/domain/seriesPort.ts's ChartSeriesPort: one port,
// implemented once in infra, consumed by both find_similar_setups (T-1012-4)
// and explain_similarity (T-1012-5) rather than each ticket building its own
// HTTP client against the same three endpoints.
import type { WireError } from '../../domain/errors';
import type {
	Normalization,
	SearchScope,
	SimilarityExplanation,
	SimilarityRun,
	WindowRef
} from './contract';

export interface SimilaritySearchRequest {
	instrumentId: string;
	window: WindowRef;
	scope: SearchScope;
	weights?: Partial<Record<string, number>>;
	normalization?: Normalization;
	limit?: number;
	minScore?: number;
	referenceSetupId?: string;
}

export type SimilarityApiErrorReason =
	| 'not_found_run'
	| 'not_found_candidate'
	| 'validation'
	| 'reference_unavailable'
	| 'source_unavailable'
	| 'malformed_response';

// The API layer's own failure type -- a raw transport exception never
// escapes an adapter, matching ChartSeriesError's convention exactly.
export class SimilarityApiError extends Error {
	readonly reason: SimilarityApiErrorReason;

	constructor(reason: SimilarityApiErrorReason, message: string, options?: { cause?: unknown }) {
		super(message, { cause: options?.cause });
		this.name = 'SimilarityApiError';
		this.reason = reason;
	}

	toWireError(): WireError {
		return { error: `similarity_api_${this.reason}`, message: this.message, reason: this.reason };
	}
}

export interface SimilarityApiPort {
	search(request: SimilaritySearchRequest): Promise<SimilarityRun>;
	explain(runId: string, candidateId: string): Promise<SimilarityExplanation>;
}

export type { SearchScope };
