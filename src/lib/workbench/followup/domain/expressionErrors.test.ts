import { describe, expect, it } from 'vitest';
import { EXPRESSION_ERROR_REASONS, ExpressionValidationError } from './expressionErrors';

describe('ExpressionValidationError', () => {
	it('test_unresolved_field_carries_the_field_id_and_suggestions_as_vocabulary', () => {
		const error = ExpressionValidationError.unresolvedField('root', 'field.bogus', [
			'field.close',
			'field.open'
		]);
		expect(error.reason, 'wrong reason code').toBe('unresolved_field');
		expect(error.message, 'field id should be named in the message').toContain('field.bogus');
		expect(
			error.permittedVocabulary,
			'permitted vocabulary should carry the suggested alternatives'
		).toEqual(['field.close', 'field.open']);
	});

	it('test_to_wire_error_uses_snake_case_and_carries_permitted_vocabulary', () => {
		const error = ExpressionValidationError.missingArgument('root', 'study.sma', ['length']);
		const wire = error.toWireError();
		expect(wire.error, 'wire error code should be the reason').toBe('missing_argument');
		expect(wire.permitted_vocabulary, 'wire shape should carry snake_case vocabulary').toEqual([
			'length'
		]);
		expect(wire.path, 'wire shape should carry the node path').toBe('root');
	});

	it('test_every_reason_used_by_a_factory_is_listed_in_the_reason_enum', () => {
		const producedReasons = new Set([
			ExpressionValidationError.unknownNodeKind('root', 'x').reason,
			ExpressionValidationError.invalidOperator('root', 'arithmetic', '?', ['+']).reason,
			ExpressionValidationError.invalidLiteral('root', 'number', 'x').reason,
			ExpressionValidationError.unresolvedField('root', 'x', []).reason,
			ExpressionValidationError.unresolvedFunction('root', 'x', []).reason,
			ExpressionValidationError.typeMismatch('root', 'x', []).reason,
			ExpressionValidationError.unitMismatch('root', 'a', 'b').reason,
			ExpressionValidationError.missingArgument('root', 'x', []).reason,
			ExpressionValidationError.unexpectedArgument('root', 'x', 'y', []).reason,
			ExpressionValidationError.argumentTypeMismatch('root', 'x', 'y', 'number').reason,
			ExpressionValidationError.argumentOutOfRange('root', 'x', 'y', {}).reason,
			ExpressionValidationError.unknownOutput('root', 'x', 'y', []).reason,
			ExpressionValidationError.ambiguousOutput('root', 'x', []).reason,
			ExpressionValidationError.depthExceeded('root', 8).reason,
			ExpressionValidationError.nodeCountExceeded(64).reason,
			ExpressionValidationError.lookbackExceeded('root', 'x', 'y', 999, 500).reason
		]);
		for (const reason of producedReasons) {
			expect(
				EXPRESSION_ERROR_REASONS,
				`"${reason}" produced by a factory is missing from EXPRESSION_ERROR_REASONS`
			).toContain(reason);
		}
	});
});
