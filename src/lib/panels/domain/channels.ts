// The five channels panels can be linked on. A link group is undirected and
// scoped to exactly one channel, so a panel may belong to several groups at
// once without one channel's value ever reaching another channel's members.

export type PanelLinkChannel =
	'symbol' | 'timeframe' | 'result_selection' | 'crosshair' | 'filters';

export const PANEL_LINK_CHANNELS: readonly PanelLinkChannel[] = [
	'symbol',
	'timeframe',
	'result_selection',
	'crosshair',
	'filters'
];

export function isPanelLinkChannel(value: unknown): value is PanelLinkChannel {
	return typeof value === 'string' && (PANEL_LINK_CHANNELS as readonly string[]).includes(value);
}
