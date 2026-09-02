// maximize_panel is the one operation in this epic that never touches the
// workspace: it's rendering-only client state layered over the saved
// layout, so restoring from maximize is free (no revision to consume, no
// undo token to redeem) and the saved footprints are never at risk of
// drifting from what maximizing displayed.
import { fullGridRect, type OccupiedRect } from '../domain/layout';
import type { Panel } from '../domain/panel';

// The rects to actually render, given the saved layout and an optional
// maximized panel. Never touches stored footprints. When a panel is
// maximized, only that panel renders (at the full grid) -- every other
// panel's saved position and size stays exactly as stored, simply not
// rendered until the maximized state clears.
export function renderedRects(panels: Panel[], maximizedPanelId: string | null): OccupiedRect[] {
	const visible = panels.filter((p) => !p.hidden);
	if (maximizedPanelId !== null) {
		const maximized = visible.find((p) => p.id === maximizedPanelId);
		if (maximized) {
			return [{ panelId: maximized.id, rect: fullGridRect() }];
		}
	}
	return visible.map((p) => ({ panelId: p.id, rect: p.rect }));
}
