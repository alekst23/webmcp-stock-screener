// Typed rejections the study engine raises. Callers branch on the error type
// and read the structured fields; nothing downstream parses a message string.
// Each serializes through `toWireError()` in the same shape as the workbench
// domain errors, so a tool handler maps them uniformly.

import type { WireError } from '../../../domain/errors';

export class UnknownStudyError extends Error {
	readonly catalogItemId: string;
	readonly suggestions: readonly string[];

	constructor(catalogItemId: string, suggestions: readonly string[]) {
		const tail =
			suggestions.length > 0
				? ` Did you mean ${suggestions.join(', ')}?`
				: ' Search the catalog first.';
		super(`"${catalogItemId}" is not a study this engine can compute.${tail}`);
		this.name = 'UnknownStudyError';
		this.catalogItemId = catalogItemId;
		this.suggestions = suggestions;
	}

	toWireError(): WireError {
		return {
			error: 'unknown_study',
			message: this.message,
			catalog_item_id: this.catalogItemId,
			suggestions: [...this.suggestions]
		};
	}
}

export class StudyParameterError extends Error {
	readonly catalogItemId: string;
	readonly parameter: string;
	readonly value: unknown;
	// Human-readable statement of what would have been accepted, taken from the
	// catalog's declaration rather than restated here.
	readonly permitted: string;

	constructor(catalogItemId: string, parameter: string, value: unknown, permitted: string) {
		super(
			`Parameter "${parameter}" of ${catalogItemId} was ${describeValue(value)}, ` +
				`but it must be ${permitted}.`
		);
		this.name = 'StudyParameterError';
		this.catalogItemId = catalogItemId;
		this.parameter = parameter;
		this.value = value;
		this.permitted = permitted;
	}

	toWireError(): WireError {
		return {
			error: 'study_parameter_out_of_range',
			message: this.message,
			catalog_item_id: this.catalogItemId,
			parameter: this.parameter,
			value: this.value,
			permitted: this.permitted
		};
	}
}

// Raised for a bar the selected study cannot read. Only the fields that study
// actually uses are checked, so a missing volume never blocks a moving average.
export class StudyInputError extends Error {
	readonly barIndex: number;
	readonly field: string;
	readonly requirement: string;

	constructor(barIndex: number, field: string, value: unknown, requirement: string) {
		super(
			`Bar ${barIndex} has an unusable "${field}": ${describeValue(value)}. It must be ${requirement}.`
		);
		this.name = 'StudyInputError';
		this.barIndex = barIndex;
		this.field = field;
		this.requirement = requirement;
	}

	toWireError(): WireError {
		return {
			error: 'study_input_invalid',
			message: this.message,
			bar_index: this.barIndex,
			field: this.field,
			requirement: this.requirement
		};
	}
}

function describeValue(value: unknown): string {
	if (value === undefined) return 'not supplied';
	if (typeof value === 'string') return `"${value}"`;
	return String(value);
}
