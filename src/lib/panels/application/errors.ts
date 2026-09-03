// One error shape for every panel-specific failure this epic raises, so
// T-1007-5 can turn `code` and `details` into agent-facing text without
// parsing a message string or branching on which wave-1 module threw.
// Wave-1's own typed failures (PlacementViolation, LinkFailure,
// UnknownPanelKindError, ...) carry the same information but in shapes
// specific to their own module -- this wraps them, it doesn't replace them.
import type { WireError } from '../../workbench/domain/errors';

export type PanelOperationErrorCode =
	| 'unknown_panel_kind'
	| 'unknown_panel'
	| 'panel_id_collision'
	| 'unknown_layout_template'
	| 'unknown_renderer_type'
	| 'invalid_config'
	| 'invalid_selection'
	| 'invalid_source'
	| 'incompatible_renderer'
	| 'wrong_renderer'
	| 'no_active_renderer'
	| 'grid_full'
	| 'invalid_size'
	| 'out_of_bounds'
	| 'below_minimum'
	| 'overlap'
	| 'batch_conflict'
	| 'self_link'
	| 'unknown_link_panel'
	| 'unsupported_channel'
	| 'not_linked'
	| 'template_panel_count_mismatch';

export class PanelOperationError extends Error {
	readonly code: PanelOperationErrorCode;
	readonly details: Record<string, unknown>;

	constructor(
		code: PanelOperationErrorCode,
		message: string,
		details: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'PanelOperationError';
		this.code = code;
		this.details = details;
	}

	toWireError(): WireError {
		return { error: this.code, message: this.message, ...this.details };
	}
}
