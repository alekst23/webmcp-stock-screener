// Pure logic for `compare_setups` (T-1012-7): validating which candidates
// of a similarity run can be shown together in a given comparison form, and
// building the view descriptor a panel renders from. No I/O, no Svelte.
import type { MarketDataProvenance, Normalization, SimilarityRun } from '../../domain/contract';

export type ComparisonForm = 'overlay' | 'synchronized_charts' | 'small_multiples';

export const COMPARISON_FORMS: readonly ComparisonForm[] = [
	'overlay',
	'synchronized_charts',
	'small_multiples'
];

export function isComparisonForm(value: unknown): value is ComparisonForm {
	return typeof value === 'string' && (COMPARISON_FORMS as readonly string[]).includes(value);
}

// Legibility caps per form (AC9) -- an overlay of a dozen lines is noise, a
// small-multiples grid can hold more tiles than a set of full-size
// synchronized charts can fit side by side. Explicit and documented, not
// derived from viewport size, matching this project's other explicit-bound
// conventions (e.g. the engine's own _MAX_RAW_CANDIDATES_PER_SCOPE).
export const FORM_CAPS: Record<ComparisonForm, number> = {
	overlay: 6,
	synchronized_charts: 4,
	small_multiples: 9
};

// Thrown, not returned, matching this epic's other validation-failure
// conventions (SimilarityWeightError, CaptureSetupError): a caller that
// ignored this would otherwise proceed with a view referencing a candidate
// that was never actually part of the run (AC8).
export class CandidateSelectionError extends Error {
	readonly runId: string;
	readonly unknownCandidateIds: string[];

	constructor(runId: string, unknownCandidateIds: string[]) {
		super(
			`Candidate(s) not part of run "${runId}": ${unknownCandidateIds.join(', ')}. No view change was made.`
		);
		this.name = 'CandidateSelectionError';
		this.runId = runId;
		this.unknownCandidateIds = unknownCandidateIds;
	}
}

export interface ComparisonSelection {
	// Preserves the caller's requested order (a caller may have ranked
	// candidates in a meaningful order of its own); capping trims from the
	// end rather than re-sorting.
	shown: string[];
	warnings: string[];
}

// @throws {CandidateSelectionError} when any requested candidate id is not
// part of the named run (AC8) -- the whole request is rejected, never a
// partial view silently substituting the candidates that did resolve.
export function resolveComparisonCandidates(
	run: SimilarityRun,
	candidateIds: string[],
	form: ComparisonForm
): ComparisonSelection {
	const known = new Set(run.candidates.map((c) => c.candidateId));
	const unknown = candidateIds.filter((id) => !known.has(id));
	if (unknown.length > 0) {
		throw new CandidateSelectionError(run.runId, unknown);
	}
	const cap = FORM_CAPS[form];
	if (candidateIds.length <= cap) {
		return { shown: candidateIds, warnings: [] };
	}
	const shown = candidateIds.slice(0, cap);
	const dropped = candidateIds.slice(cap);
	return {
		shown,
		warnings: [
			`Requested ${candidateIds.length} candidates, more than "${form}" can legibly display. ` +
				`Showing the first ${cap}: ${shown.join(', ')}. Not shown: ${dropped.join(', ')}.`
		]
	};
}

export interface ComparisonView {
	runId: string;
	referenceSetupId: string;
	form: ComparisonForm;
	// The reference is always included and distinguished as the baseline
	// (AC3) -- carried as its own field, never mixed into candidateIds, so a
	// renderer can never confuse the baseline for a candidate.
	candidateIds: string[];
	normalization: Normalization;
	provenance: MarketDataProvenance;
	warnings: string[];
}

// @throws {CandidateSelectionError} see resolveComparisonCandidates.
export function buildComparisonView(
	run: SimilarityRun,
	candidateIds: string[],
	form: ComparisonForm
): ComparisonView {
	const selection = resolveComparisonCandidates(run, candidateIds, form);
	return {
		runId: run.runId,
		referenceSetupId: run.referenceSetupId,
		form,
		candidateIds: selection.shown,
		// The normalization settings applied come from the captured setup that
		// produced the run (AC5) -- the run already carries them (T-1012-1/2),
		// so this is a passthrough, never re-derived.
		normalization: run.normalization,
		provenance: run.provenance,
		warnings: [...run.warnings, ...selection.warnings]
	};
}
