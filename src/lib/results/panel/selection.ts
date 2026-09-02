// Pure selection-set arithmetic for a row click/checkbox toggle -- kept
// separate from the mutation call itself (setPanelSelection.ts) so "what
// does clicking this row do to the selected-id list" is unit-testable
// without a workspace, a panel, or a run.
export function toggleSelection(current: readonly string[], id: string): string[] {
	return current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id];
}
