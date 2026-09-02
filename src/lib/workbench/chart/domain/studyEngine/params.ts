// Resolving a study's parameters against what the catalog declares about them.
// Defaults, valid ranges and enum members are read from the catalog item on
// every call -- this module holds no table of its own, so a catalog change
// takes effect here without an edit.
//
// Nothing is ever clamped. A value outside its declared range is a rejection
// naming the parameter, the value and what would have been accepted, because a
// silently corrected period produces a chart that disagrees with the request
// that drew it.

import type { CatalogParameter, StudyItem } from '../../../../catalog/types';
import { StudyParameterError } from './errors';

export type StudyParamValue = number | string | boolean;
export type StudyParamInput = Readonly<Record<string, StudyParamValue>>;
export type ResolvedStudyParams = Readonly<Record<string, StudyParamValue>>;

export function resolveParams(item: StudyItem, input: StudyParamInput): ResolvedStudyParams {
	rejectUnknownNames(item, input);
	const resolved: Record<string, StudyParamValue> = {};
	for (const parameter of item.parameters) {
		resolved[parameter.name] = resolveOne(item, parameter, input[parameter.name]);
	}
	return resolved;
}

function rejectUnknownNames(item: StudyItem, input: StudyParamInput): void {
	const declared = new Set(item.parameters.map((p) => p.name));
	for (const name of Object.keys(input)) {
		if (!declared.has(name)) {
			throw new StudyParameterError(
				item.id,
				name,
				input[name],
				`omitted -- ${item.label} declares only ${[...declared].join(', ') || 'no parameters'}`
			);
		}
	}
}

function resolveOne(
	item: StudyItem,
	parameter: CatalogParameter,
	supplied: StudyParamValue | undefined
): StudyParamValue {
	if (supplied === undefined) {
		if (parameter.defaultValue === null) {
			throw new StudyParameterError(item.id, parameter.name, undefined, describe(parameter));
		}
		return parameter.defaultValue;
	}
	if (parameter.valueType === 'number') {
		return checkNumber(item, parameter, supplied);
	}
	if (parameter.valueType === 'boolean') {
		if (typeof supplied !== 'boolean') {
			throw new StudyParameterError(item.id, parameter.name, supplied, describe(parameter));
		}
		return supplied;
	}
	return checkText(item, parameter, supplied);
}

function checkNumber(
	item: StudyItem,
	parameter: CatalogParameter,
	supplied: StudyParamValue
): number {
	if (typeof supplied !== 'number' || !Number.isFinite(supplied)) {
		throw new StudyParameterError(item.id, parameter.name, supplied, describe(parameter));
	}
	// A period is a count of bars; a fractional one has no meaning and would
	// silently round somewhere inside the arithmetic.
	if (parameter.unit === 'bars' && !Number.isInteger(supplied)) {
		throw new StudyParameterError(item.id, parameter.name, supplied, describe(parameter));
	}
	const range = parameter.range;
	if (range) {
		const belowMin = range.min !== undefined && supplied < range.min;
		const aboveMax = range.max !== undefined && supplied > range.max;
		if (belowMin || aboveMax) {
			throw new StudyParameterError(item.id, parameter.name, supplied, describe(parameter));
		}
	}
	return supplied;
}

function checkText(
	item: StudyItem,
	parameter: CatalogParameter,
	supplied: StudyParamValue
): string {
	if (typeof supplied !== 'string') {
		throw new StudyParameterError(item.id, parameter.name, supplied, describe(parameter));
	}
	if (parameter.enumValues && !parameter.enumValues.includes(supplied)) {
		throw new StudyParameterError(item.id, parameter.name, supplied, describe(parameter));
	}
	return supplied;
}

// Every rejection message ends with this, so the caller is told the permitted
// values in the same breath as the refusal.
export function describe(parameter: CatalogParameter): string {
	if (parameter.enumValues) {
		return `one of ${parameter.enumValues.map((v) => `"${v}"`).join(', ')}`;
	}
	if (parameter.valueType !== 'number') {
		return `a ${parameter.valueType}`;
	}
	const noun = parameter.unit === 'bars' ? 'a whole number of bars' : 'a finite number';
	const range = parameter.range;
	if (!range || (range.min === undefined && range.max === undefined)) {
		return noun;
	}
	if (range.min !== undefined && range.max !== undefined) {
		return `${noun} from ${range.min} to ${range.max}`;
	}
	return range.min !== undefined
		? `${noun} of at least ${range.min}`
		: `${noun} of at most ${range.max}`;
}
