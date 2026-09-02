// The error case expression validation returns (T-1014-1 AC8). A caller
// branches on `.reason`, never on parsing `.message`. Follows
// `domain/previewErrors.ts`'s SafetyError pattern: a reason enum, static
// factories, a `details` bag, and `toWireError()`. Every factory attaches
// `permittedVocabulary` -- the fixed set of names/values that would have
// been accepted -- so an agent can self-correct in one turn without a
// second round trip.
import type { WireError } from '../../domain/errors';

export type ExpressionErrorReason =
	| 'unknown_node_kind'
	| 'invalid_literal'
	| 'unresolved_field'
	| 'unresolved_function'
	| 'type_mismatch'
	| 'unit_mismatch'
	| 'missing_argument'
	| 'unexpected_argument'
	| 'argument_type_mismatch'
	| 'argument_out_of_range'
	| 'unknown_output'
	| 'ambiguous_output'
	| 'depth_exceeded'
	| 'node_count_exceeded'
	| 'lookback_exceeded';

export const EXPRESSION_ERROR_REASONS: readonly ExpressionErrorReason[] = [
	'unknown_node_kind',
	'invalid_literal',
	'unresolved_field',
	'unresolved_function',
	'type_mismatch',
	'unit_mismatch',
	'missing_argument',
	'unexpected_argument',
	'argument_type_mismatch',
	'argument_out_of_range',
	'unknown_output',
	'ambiguous_output',
	'depth_exceeded',
	'node_count_exceeded',
	'lookback_exceeded'
];

type ErrorDetails = Record<string, unknown>;

export class ExpressionValidationError extends Error {
	readonly reason: ExpressionErrorReason;
	// Dotted location of the offending node, e.g. "root.left.right".
	readonly path: string;
	// The permitted vocabulary relevant to this failure: catalog IDs,
	// parameter/output names, allowed literal kinds, or a stated limit --
	// whatever an agent needs to pick a valid replacement.
	readonly permittedVocabulary: readonly string[];
	readonly details: ErrorDetails;

	constructor(
		reason: ExpressionErrorReason,
		path: string,
		message: string,
		permittedVocabulary: readonly string[],
		details: ErrorDetails = {}
	) {
		super(message);
		this.name = 'ExpressionValidationError';
		this.reason = reason;
		this.path = path;
		this.permittedVocabulary = permittedVocabulary;
		this.details = details;
	}

	toWireError(): WireError {
		return {
			error: this.reason,
			message: this.message,
			path: this.path,
			permitted_vocabulary: this.permittedVocabulary,
			...this.details
		};
	}

	static unknownNodeKind(path: string, receivedKind: unknown): ExpressionValidationError {
		return new ExpressionValidationError(
			'unknown_node_kind',
			path,
			`Expression node at "${path}" has unsupported kind ${JSON.stringify(receivedKind)}.`,
			['literal', 'field_ref', 'function_call', 'arithmetic', 'comparison']
		);
	}

	static invalidOperator(
		path: string,
		nodeKind: 'arithmetic' | 'comparison',
		op: unknown,
		permitted: readonly string[]
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'unknown_node_kind',
			path,
			`${nodeKind} node at "${path}" has unsupported operator ${JSON.stringify(op)}.`,
			permitted
		);
	}

	static invalidLiteral(path: string, valueType: unknown, value: unknown): ExpressionValidationError {
		return new ExpressionValidationError(
			'invalid_literal',
			path,
			`Literal at "${path}" declares valueType ${JSON.stringify(valueType)} but its value ` +
				`(${JSON.stringify(value)}) does not match it.`,
			['number', 'string', 'boolean']
		);
	}

	static unresolvedField(path: string, fieldId: string, suggestions: readonly string[]) {
		return new ExpressionValidationError(
			'unresolved_field',
			path,
			`"${fieldId}" at "${path}" is not a known catalog field.`,
			suggestions,
			{ field_id: fieldId }
		);
	}

	static unresolvedFunction(path: string, functionId: string, suggestions: readonly string[]) {
		return new ExpressionValidationError(
			'unresolved_function',
			path,
			`"${functionId}" at "${path}" is not a known catalog study, indicator, or pattern.`,
			suggestions,
			{ function_id: functionId }
		);
	}

	static typeMismatch(
		path: string,
		explanation: string,
		permittedVocabulary: readonly string[]
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'type_mismatch',
			path,
			`Type mismatch at "${path}": ${explanation}`,
			permittedVocabulary
		);
	}

	static unitMismatch(
		path: string,
		leftUnit: string | undefined,
		rightUnit: string | undefined
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'unit_mismatch',
			path,
			`Unit mismatch at "${path}": left operand is ${leftUnit ?? 'unitless'}, right operand ` +
				`is ${rightUnit ?? 'unitless'}.`,
			[leftUnit ?? 'unitless', rightUnit ?? 'unitless']
		);
	}

	static missingArgument(
		path: string,
		functionId: string,
		missing: readonly string[]
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'missing_argument',
			path,
			`Call to "${functionId}" at "${path}" is missing required argument(s): ${missing.join(', ')}.`,
			missing,
			{ function_id: functionId }
		);
	}

	static unexpectedArgument(
		path: string,
		functionId: string,
		argName: string,
		declared: readonly string[]
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'unexpected_argument',
			path,
			`Call to "${functionId}" at "${path}" passes unknown argument "${argName}".`,
			declared,
			{ function_id: functionId }
		);
	}

	static argumentTypeMismatch(
		path: string,
		functionId: string,
		argName: string,
		expectedValueType: string
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'argument_type_mismatch',
			path,
			`Argument "${argName}" of "${functionId}" at "${path}" must be of type ${expectedValueType}.`,
			[expectedValueType],
			{ function_id: functionId, argument: argName }
		);
	}

	static argumentOutOfRange(
		path: string,
		functionId: string,
		argName: string,
		range: { min?: number; max?: number }
	): ExpressionValidationError {
		const bound = `[${range.min ?? '-Infinity'}, ${range.max ?? 'Infinity'}]`;
		return new ExpressionValidationError(
			'argument_out_of_range',
			path,
			`Argument "${argName}" of "${functionId}" at "${path}" must fall within ${bound}.`,
			[bound],
			{ function_id: functionId, argument: argName }
		);
	}

	static unknownOutput(
		path: string,
		functionId: string,
		outputName: string,
		declared: readonly string[]
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'unknown_output',
			path,
			`"${functionId}" at "${path}" has no output named "${outputName}".`,
			declared,
			{ function_id: functionId }
		);
	}

	static ambiguousOutput(
		path: string,
		functionId: string,
		declared: readonly string[]
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'ambiguous_output',
			path,
			`"${functionId}" at "${path}" has more than one output; an outputName must be specified.`,
			declared,
			{ function_id: functionId }
		);
	}

	static depthExceeded(path: string, maxDepth: number): ExpressionValidationError {
		return new ExpressionValidationError(
			'depth_exceeded',
			path,
			`Expression at "${path}" exceeds the maximum nesting depth of ${maxDepth}.`,
			[`maxDepth=${maxDepth}`]
		);
	}

	static nodeCountExceeded(maxNodes: number): ExpressionValidationError {
		return new ExpressionValidationError(
			'node_count_exceeded',
			'root',
			`Expression has more than the maximum of ${maxNodes} nodes.`,
			[`maxNodes=${maxNodes}`]
		);
	}

	static lookbackExceeded(
		path: string,
		functionId: string,
		argName: string,
		requested: number,
		maxLookbackBars: number
	): ExpressionValidationError {
		return new ExpressionValidationError(
			'lookback_exceeded',
			path,
			`Argument "${argName}" of "${functionId}" at "${path}" requests a lookback of ` +
				`${requested} bars, exceeding the maximum of ${maxLookbackBars}.`,
			[`maxLookbackBars=${maxLookbackBars}`],
			{ function_id: functionId, argument: argName }
		);
	}
}
