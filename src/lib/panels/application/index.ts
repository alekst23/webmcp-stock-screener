// Barrel for the thirteen revisioned use cases plus maximize_panel's pure
// helper -- the composition surface T-1007-5's tool schemas build on.
export type { PanelUseCaseDeps, PanelMutationResult } from './support';
export { PanelOperationError, type PanelOperationErrorCode } from './errors';
export {
	readPanelState,
	writePanelState,
	emptyPanelState,
	panelIdSeed,
	type PanelSystemState
} from './panelState';
export { renderedRects } from './maximize';

export { createPanel, type CreatePanelRequest } from './createPanel';
export { duplicatePanel, type DuplicatePanelRequest } from './duplicatePanel';
export { removePanel, type RemovePanelRequest } from './removePanel';
export { setPanelLayout, type SetPanelLayoutRequest } from './setPanelLayout';
export { applyLayoutTemplate, type ApplyLayoutTemplateRequest } from './applyLayoutTemplate';
export { splitPanel, type SplitPanelRequest } from './splitPanel';
export { bindPanelSource, type BindPanelSourceRequest } from './bindPanelSource';
export { setPanelRenderer, type SetPanelRendererRequest } from './setPanelRenderer';
export { configureChartGrid, type ConfigureChartGridRequest } from './configureChartGrid';
export { configurePanelView, type ConfigurePanelViewRequest } from './configurePanelView';
export { linkPanels, type LinkPanelsRequest } from './linkPanels';
export { unlinkPanels, type UnlinkPanelsRequest } from './unlinkPanels';
export { setPanelSelection, type SetPanelSelectionRequest } from './setPanelSelection';
