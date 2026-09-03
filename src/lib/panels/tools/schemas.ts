// Every JSON-Schema fragment a tool exposes is built here, from the
// injected registries, at buildPanelTools() call time -- never hand-typed
// per kind/source-type/renderer-type/template. This is the whole point of
// AC3: a sibling epic registering a ninth kind, a fifth source type, or a
// new renderer changes these schemas with no edit to this file.
import { GRID_COLUMNS, GRID_ROWS } from '../domain/grid';
import { PANEL_LINK_CHANNELS } from '../domain/channels';
import type { PanelUseCaseDeps } from '../application';

export const GRID_BOUNDS_TEXT = `${GRID_COLUMNS}-column by ${GRID_ROWS}-row grid, both zero-based`;

export function revisionFields(): Record<string, object> {
	return {
		expected_revision: {
			type: 'number',
			description:
				'Revision this call assumes the workspace is currently at. Omitting it skips the ' +
				'concurrency check; a mismatch fails with error "revision_conflict".'
		},
		idempotency_key: {
			type: 'string',
			description:
				'Replaying the same key returns the original result instead of applying the change ' +
				'twice; reusing a key for a materially different request fails with error ' +
				'"idempotency_conflict".'
		}
	};
}

export function panelIdField(description = 'Stable panel id.'): object {
	return { type: 'string', description };
}

export function gridRectSchema(): object {
	return {
		type: 'object',
		description: `Footprint in grid cells (${GRID_BOUNDS_TEXT}). No pixel, percentage, or viewport unit.`,
		properties: {
			col: {
				type: 'integer',
				minimum: 0,
				maximum: GRID_COLUMNS - 1,
				description: 'Zero-based column.'
			},
			row: { type: 'integer', minimum: 0, maximum: GRID_ROWS - 1, description: 'Zero-based row.' },
			col_span: {
				type: 'integer',
				minimum: 1,
				maximum: GRID_COLUMNS,
				description: 'Columns spanned.'
			},
			row_span: { type: 'integer', minimum: 1, maximum: GRID_ROWS, description: 'Rows spanned.' }
		},
		required: ['col', 'row', 'col_span', 'row_span']
	};
}

function extractProperties(schema: object | undefined): Record<string, object> {
	const properties = (schema as { properties?: Record<string, object> } | undefined)?.properties;
	return properties ?? {};
}

export function kindConfigSchemas(deps: PanelUseCaseDeps): Record<string, object> {
	return Object.fromEntries(deps.kinds.list().map((k) => [k.kind, k.configSchema]));
}

export function rendererConfigSchemas(deps: PanelUseCaseDeps): Record<string, object> {
	return Object.fromEntries(
		deps.sourceRenderer.listRendererTypes().map((r) => [r.name, r.configSchema])
	);
}

export function sourceRefSchemas(deps: PanelUseCaseDeps): Record<string, object> {
	return Object.fromEntries(
		deps.sourceRenderer.listSourceTypes().map((s) => [s.name, s.refSchema])
	);
}

function enumDescription(label: string, names: string[]): string {
	return `${label} One of: ${names.length > 0 ? names.join(', ') : '(none registered)'}.`;
}

export function sourceRefFieldSchema(deps: PanelUseCaseDeps, opts: { nullable: boolean }): object {
	const sourceTypeNames = deps.sourceRenderer.sourceTypeNames();
	return {
		type: opts.nullable ? ['object', 'null'] : 'object',
		description: opts.nullable
			? 'Data source to bind; omit or null for an unbound panel.'
			: 'Data source to bind.',
		properties: {
			type: {
				type: 'string',
				enum: sourceTypeNames,
				description: enumDescription('Registered source type.', sourceTypeNames)
			},
			ref: {
				type: 'object',
				description: 'Shape depends on "type"; see x-source-ref-schemas for each type\'s schema.'
			}
		},
		required: ['type', 'ref']
	};
}

export function createPanelSchema(deps: PanelUseCaseDeps): object {
	const kindNames = deps.kinds.names();
	const rendererNames = deps.sourceRenderer.rendererTypeNames();
	return {
		type: 'object',
		properties: {
			kind: {
				type: 'string',
				enum: kindNames,
				description: enumDescription('Registered panel kind.', kindNames)
			},
			title: { type: 'string', description: "Defaults to the kind's own default title." },
			config: {
				type: 'object',
				description:
					"Kind-specific configuration; defaults to the kind's own default config. See " +
					"x-kind-config-schemas for each registered kind's schema."
			},
			source: sourceRefFieldSchema(deps, { nullable: true }),
			renderer: {
				type: ['string', 'null'],
				enum: [...rendererNames, null],
				description:
					"Initial renderer; defaults to the kind's default renderer. " +
					enumDescription('Registered renderer types.', rendererNames) +
					' See x-renderer-config-schemas.'
			},
			rect: {
				...gridRectSchema(),
				description: `Explicit footprint (${GRID_BOUNDS_TEXT}); auto-placed when omitted.`
			},
			...revisionFields()
		},
		required: ['kind'],
		'x-kind-config-schemas': kindConfigSchemas(deps),
		'x-renderer-config-schemas': rendererConfigSchemas(deps),
		'x-source-ref-schemas': sourceRefSchemas(deps)
	};
}

export function duplicatePanelSchema(deps: PanelUseCaseDeps): object {
	return {
		type: 'object',
		properties: {
			panel_id: panelIdField('Panel to duplicate.'),
			symbol_override: {
				type: 'string',
				description: "Overrides the copy's config.symbol, when the kind declares one."
			},
			source_override: {
				...sourceRefFieldSchema(deps, { nullable: true }),
				description: "Overrides the copy's source; null clears it, omit to copy the original's."
			},
			...revisionFields()
		},
		required: ['panel_id'],
		'x-source-ref-schemas': sourceRefSchemas(deps)
	};
}

export function removePanelSchema(): object {
	return {
		type: 'object',
		properties: { panel_id: panelIdField('Panel to remove.'), ...revisionFields() },
		required: ['panel_id']
	};
}

export function setPanelLayoutSchema(): object {
	return {
		type: 'object',
		properties: {
			placements: {
				type: 'array',
				minItems: 1,
				description: `Batch of panel footprints to apply atomically (${GRID_BOUNDS_TEXT}).`,
				items: {
					type: 'object',
					properties: { panel_id: panelIdField(), rect: gridRectSchema() },
					required: ['panel_id', 'rect']
				}
			},
			...revisionFields()
		},
		required: ['placements']
	};
}

export function resetLayoutSchema(): object {
	return {
		type: 'object',
		properties: { ...revisionFields() }
	};
}

export function applyLayoutTemplateSchema(deps: PanelUseCaseDeps): object {
	const templateNames = deps.templates.names();
	return {
		type: 'object',
		properties: {
			template_name: {
				type: 'string',
				enum: templateNames,
				description: enumDescription('Registered layout template.', templateNames)
			},
			panel_ids: {
				type: 'array',
				items: { type: 'string' },
				minItems: 1,
				description: "Panel ids in slot order; length must match the template's slot count."
			},
			...revisionFields()
		},
		required: ['template_name', 'panel_ids']
	};
}

export function splitPanelSchema(): object {
	return {
		type: 'object',
		properties: {
			panel_id: panelIdField('Panel to split.'),
			direction: {
				type: 'string',
				enum: ['horizontal', 'vertical'],
				description: 'vertical splits into left/right halves; horizontal splits into top/bottom.'
			},
			title: {
				type: 'string',
				description: "Title for the newly created half; defaults to the original's."
			},
			...revisionFields()
		},
		required: ['panel_id', 'direction']
	};
}

export function maximizePanelSchema(): object {
	return {
		type: 'object',
		properties: {
			panel_id: {
				type: 'string',
				description: 'Panel to maximize. Omit to clear the maximized state.'
			}
		}
	};
}

export function bindPanelSourceSchema(deps: PanelUseCaseDeps): object {
	return {
		type: 'object',
		properties: {
			panel_id: panelIdField('Panel to bind.'),
			source: sourceRefFieldSchema(deps, { nullable: false }),
			...revisionFields()
		},
		required: ['panel_id', 'source'],
		'x-source-ref-schemas': sourceRefSchemas(deps)
	};
}

export function setPanelRendererSchema(deps: PanelUseCaseDeps): object {
	const rendererNames = deps.sourceRenderer.rendererTypeNames();
	return {
		type: 'object',
		properties: {
			panel_id: panelIdField(),
			renderer: {
				type: 'string',
				enum: rendererNames,
				description: enumDescription('Registered renderer type.', rendererNames)
			},
			...revisionFields()
		},
		required: ['panel_id', 'renderer'],
		'x-renderer-config-schemas': rendererConfigSchemas(deps)
	};
}

const CHART_GRID_RENDERER = 'chart_grid';

function camelToSnake(field: string): string {
	return field.replace(/([A-Z])/g, '_$1').toLowerCase();
}

// Generated from the "chart_grid" RendererTypeDefinition's own configSchema
// rather than a hand-typed rows/columns/... list -- when that renderer's
// schema changes (or a sibling epic replaces the definition), this schema
// changes with it.
export function configureChartGridSchema(deps: PanelUseCaseDeps): object {
	const rendererDef = deps.sourceRenderer.getRendererType(CHART_GRID_RENDERER);
	const properties: Record<string, object> = { panel_id: panelIdField() };
	for (const [field, propSchema] of Object.entries(extractProperties(rendererDef?.configSchema))) {
		properties[camelToSnake(field)] = propSchema;
	}
	return {
		type: 'object',
		description: `Fields validated against the "${CHART_GRID_RENDERER}" renderer's own configuration schema.`,
		properties: { ...properties, ...revisionFields() },
		required: ['panel_id']
	};
}

export function configurePanelViewSchema(deps: PanelUseCaseDeps): object {
	return {
		type: 'object',
		properties: {
			panel_id: panelIdField(),
			title: { type: 'string' },
			hidden: { type: 'boolean' },
			collapsed: { type: 'boolean' },
			config: {
				type: 'object',
				description:
					"Renderer-specific view configuration, merged onto the panel's current recognized " +
					"fields and validated against the panel's active renderer. See " +
					'x-renderer-config-schemas for each renderer.'
			},
			...revisionFields()
		},
		required: ['panel_id'],
		'x-renderer-config-schemas': rendererConfigSchemas(deps)
	};
}

function linkChannelField(): object {
	return {
		type: 'string',
		enum: [...PANEL_LINK_CHANNELS],
		description: enumDescription('Link channel.', [...PANEL_LINK_CHANNELS])
	};
}

export function linkPanelsSchema(): object {
	return {
		type: 'object',
		properties: {
			channel: linkChannelField(),
			panel_ids: {
				type: 'array',
				items: { type: 'string' },
				minItems: 2,
				description:
					"Panels to join into this channel's group; each must be a kind that declares the channel."
			},
			...revisionFields()
		},
		required: ['channel', 'panel_ids']
	};
}

export function unlinkPanelsSchema(): object {
	return {
		type: 'object',
		properties: {
			channel: linkChannelField(),
			panel_ids: {
				type: 'array',
				items: { type: 'string' },
				minItems: 1,
				description: "Panels to remove from this channel's group."
			},
			...revisionFields()
		},
		required: ['channel', 'panel_ids']
	};
}

export function setPanelSelectionSchema(): object {
	return {
		type: 'object',
		properties: {
			panel_id: panelIdField(),
			selected_ids: {
				type: 'array',
				items: { type: 'string' },
				description: 'Result ids selected on this panel; an empty array clears the selection.'
			},
			...revisionFields()
		},
		required: ['panel_id', 'selected_ids']
	};
}
