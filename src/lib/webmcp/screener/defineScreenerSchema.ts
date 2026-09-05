// The wire-facing description and JSON schema for define_screener
// (T-0026-1). Split out of defineScreener.ts to keep that file under the
// project's size guidance -- this is pure declaration, no logic.

export const DEFINE_SCREENER_DESCRIPTION =
	'Creates or fully replaces a screener definition in one call: universe, conditions (a ' +
	'nested filter tree of typed conditions), ranking, and a result limit. Validates everything ' +
	'together -- every unknown catalog id, out-of-range parameter, and empty-resolving universe ' +
	'is collected and returned together, never just the first one found -- and commits nothing ' +
	"when any blocking problem is found. Defaults to the workspace's current screener " +
	'(WorkspaceDocument.screenerId): omit screener_id to create one the first time and replace ' +
	'it (as a new revision, full-replace -- omitted fields reset to empty/default, they are not ' +
	'carried over) on every call after. An explicit screener_id addresses a specific screener and ' +
	'is rejected, naming it, if it does not exist. When a requested interval cannot actually be ' +
	'served by the data available, this substitutes the interval that can be and says so in ' +
	'warnings rather than rejecting the definition. Returns the mutation envelope plus the ' +
	'screener id and revision; accepts expected_revision and idempotency_key.';

const CONDITION_NODE_SCHEMA = {
	type: 'object',
	description:
		'A group ({kind:"group", op:"and"|"or"|"not", children:[...]}) or a condition -- either ' +
		'{kind:"condition", condition:{...}} or a bare condition object. "not" must hold exactly ' +
		'one child.'
};

export const DEFINE_SCREENER_INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		screener_id: {
			type: 'string',
			description: "Defaults to the workspace's current screener; rejected if unrecognized."
		},
		name: { type: 'string', description: 'A display label only, never an address.' },
		universe: {
			type: 'object',
			properties: {
				asset_class: { type: 'string' },
				exchanges: { type: 'array', items: { type: 'string' } },
				countries: { type: 'array', items: { type: 'string' } },
				sectors: { type: 'array', items: { type: 'string' } },
				industries: { type: 'array', items: { type: 'string' } },
				indexes: { type: 'array', items: { type: 'string' } },
				watchlists: { type: 'array', items: { type: 'string' } },
				liquidity: {
					type: 'object',
					properties: {
						min_price: { type: 'number' },
						min_average_volume: { type: 'number' },
						min_market_cap: { type: 'number' }
					}
				},
				exclusions: {
					type: 'object',
					properties: {
						instrument_ids: { type: 'array', items: { type: 'string' } },
						sector_ids: { type: 'array', items: { type: 'string' } },
						industry_ids: { type: 'array', items: { type: 'string' } }
					}
				}
			}
		},
		conditions: {
			description:
				'The whole filter tree in one shot: a root group, a single condition, or an array ' +
				'of nodes (treated as the root group\'s children under "and"). Omit for no conditions.',
			oneOf: [CONDITION_NODE_SCHEMA, { type: 'array', items: CONDITION_NODE_SCHEMA }]
		},
		ranking: {
			type: 'object',
			properties: {
				fields: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							field_id: { type: 'string' },
							direction: { type: 'string', enum: ['asc', 'desc'] },
							weight: { type: 'number' }
						},
						required: ['field_id']
					}
				},
				tie_break: {
					type: 'object',
					properties: {
						field_id: { type: 'string' },
						direction: { type: 'string', enum: ['asc', 'desc'] }
					},
					required: ['field_id']
				},
				normalization: { type: 'string', enum: ['percentile_rank', 'z_score', 'min_max'] }
			},
			description: 'Omit (or pass an empty "fields") for the documented default order.'
		},
		limit: { type: 'integer', minimum: 1, description: 'Maximum matches a run returns.' },
		expected_revision: {
			type: 'number',
			description:
				"Optional. The workspace's own revision, used for optimistic concurrency -- not the " +
				"screener definition's revision (returned as screener_revision in the response, but " +
				'not accepted as input here -- define_screener always writes the next revision).'
		},
		idempotency_key: { type: 'string' }
	}
};
