# Workspace Snapshots — Product Spec

## Intent

A researcher iterating across multiple lines of investigation currently
has only one, unnamed, ever-accumulating workspace per browser —
starting a new line of inquiry means losing the last one. This feature
lets them save the current workspace under a name and recall it later,
so they can keep several research threads going without overwriting each
other. Done looks like: saving a snapshot, starting fresh or loading a
different one, and switching back to the original with nothing lost.

## Preconditions

- Browser localStorage is available (same as the rest of workspace
  persistence).

## Features

1. **Save a named snapshot**: capture the entire current workspace state
   under a user-chosen name.
2. **Recall a snapshot**: replace the live workspace with a previously
   saved snapshot's contents.
3. **Delete a snapshot**: remove a saved snapshot permanently.
4. **Browse snapshots**: see every saved snapshot's name to choose from.

## Behavioral Specifications

### Save a named snapshot

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | the current live workspace state | the user saves it under a name | a snapshot with that name is stored, separately from the live workspace, and appears in the snapshot list |
| Overwrite | a snapshot already exists under that name | the user saves again under the same name | the existing snapshot is overwritten with the current state |

### Recall a snapshot

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | one or more saved snapshots | the user selects one to load | the live workspace is replaced with that snapshot's studies/setups/instance sets/panels/focus |
| Unsaved changes | the live workspace differs from the last saved/loaded snapshot | the user attempts to switch to a different snapshot | they are warned that unsaved changes will be lost before the switch proceeds |

### Delete a snapshot

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a saved snapshot | the user deletes it from the picker | it is removed from storage and no longer appears in the list; the live workspace is unaffected even if it was originally loaded from that snapshot |

### Browse snapshots

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | zero or more saved snapshots | the user opens the picker | every saved snapshot's name is listed to choose from |

## Non-Goals

- Cross-device or cross-browser sync — snapshots are local to one browser,
  same as the live workspace.
- Editing a snapshot's contents directly — only whole-state save/overwrite.
- Automatic or scheduled snapshotting — saving is always an explicit user
  action.
- The action/activity log is not part of a snapshot — it's tracked
  separately (`docs/design/pattern-research-workbench`) and unaffected by
  save/recall.
- Renaming a snapshot in place — covered by delete + save-as-new-name.

## Open Questions

None outstanding.

---

*Implemented by: EPIC-0005*
