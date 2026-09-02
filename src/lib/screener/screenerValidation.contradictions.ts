// Contradiction detection for T-1009-8, AC4: two conditions on the same
// field that cannot both hold, under an enabled AND group. Deliberately not
// a theorem prover -- only disjoint numeric bounds on one field, among
// enabled condition-node siblings directly under one enabled 'and' group,
// are covered. Nested groups, OR/NOT combinations, and cross-field
// relationships are out of scope by design; validation.ts's
// `detectionExhaustive: false` says so on every report.
//
// Split out of screenerValidation.ts to keep that file under the 400-line
// limit (per the ticket). Domain layer: no I/O, no import from
// src/lib/webmcp/ or from src/lib/screener/engine/.

import type { ConditionNode } from './definition';
import { PROBLEM_CODES, type ValidationProblem } from './validation';

// A field's permitted set reduced to one interval: [min, max], each end
// either inclusive or exclusive. `min`/`max` may be +-Infinity for an
// open-ended scalar bound (e.g. "> 10" has no upper bound).
interface Bound {
	min: number;
	minInclusive: boolean;
	max: number;
	maxInclusive: boolean;
}

// Only range and numeric-valued scalar (>, <, ==) conditions reduce to a
// bound -- the tractable cases AC4 names. Everything else (series
// comparisons, temporal, patterns, ...) has no fixed numeric bound to
// compare and is silently excluded from this pass, not misreported.
function boundOf(node: ConditionNode): { fieldId: string; bound: Bound } | null {
	const condition = node.condition;
	if (condition.type === 'range') {
		return {
			fieldId: condition.fieldId,
			bound: {
				min: condition.lower,
				minInclusive: condition.lowerInclusive,
				max: condition.upper,
				maxInclusive: condition.upperInclusive
			}
		};
	}
	if (condition.type === 'scalar' && typeof condition.value === 'number') {
		if (condition.operator === 'op.greater_than') {
			return {
				fieldId: condition.fieldId,
				bound: { min: condition.value, minInclusive: false, max: Infinity, maxInclusive: true }
			};
		}
		if (condition.operator === 'op.less_than') {
			return {
				fieldId: condition.fieldId,
				bound: { min: -Infinity, minInclusive: true, max: condition.value, maxInclusive: false }
			};
		}
		if (condition.operator === 'op.equals') {
			return {
				fieldId: condition.fieldId,
				bound: {
					min: condition.value,
					minInclusive: true,
					max: condition.value,
					maxInclusive: true
				}
			};
		}
	}
	return null;
}

function boundsDisjoint(a: Bound, b: Bound): boolean {
	if (a.max < b.min || (a.max === b.min && !(a.maxInclusive && b.minInclusive))) {
		return true;
	}
	return b.max < a.min || (b.max === a.min && !(b.maxInclusive && a.minInclusive));
}

function describeBound(bound: Bound): string {
	if (bound.min === bound.max) {
		return `= ${bound.min}`;
	}
	const parts: string[] = [];
	if (bound.min !== -Infinity) {
		parts.push(bound.minInclusive ? `>= ${bound.min}` : `> ${bound.min}`);
	}
	if (bound.max !== Infinity) {
		parts.push(bound.maxInclusive ? `<= ${bound.max}` : `< ${bound.max}`);
	}
	return parts.join(' and ');
}

function contradictionProblem(
	fieldId: string,
	a: { node: ConditionNode; bound: Bound },
	b: { node: ConditionNode; bound: Bound }
): ValidationProblem {
	return {
		severity: 'blocking',
		code: PROBLEM_CODES.contradiction,
		nodeIds: [a.node.nodeId, b.node.nodeId],
		universeCriteria: [],
		message:
			`Field "${fieldId}": node ${a.node.nodeId} requires ${describeBound(a.bound)} while node ` +
			`${b.node.nodeId} requires ${describeBound(b.bound)}. No value can satisfy both under this ` +
			'AND group.'
	};
}

// `siblings` is expected to already be filtered to the enabled condition
// nodes that are direct children of one enabled 'and' group -- this
// function does no tree walking of its own.
export function detectGroupContradictions(siblings: readonly ConditionNode[]): ValidationProblem[] {
	const byField = new Map<string, { node: ConditionNode; bound: Bound }[]>();
	for (const node of siblings) {
		const resolved = boundOf(node);
		if (!resolved) {
			continue;
		}
		const list = byField.get(resolved.fieldId) ?? [];
		list.push({ node, bound: resolved.bound });
		byField.set(resolved.fieldId, list);
	}
	const problems: ValidationProblem[] = [];
	for (const [fieldId, entries] of byField) {
		for (let i = 0; i < entries.length; i++) {
			for (let j = i + 1; j < entries.length; j++) {
				const a = entries[i];
				const b = entries[j];
				if (a && b && boundsDisjoint(a.bound, b.bound)) {
					problems.push(contradictionProblem(fieldId, a, b));
				}
			}
		}
	}
	return problems;
}
