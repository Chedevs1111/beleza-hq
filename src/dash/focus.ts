// Where keyboard focus goes when a panel or card is rebuilt under it. Pure: the island and Approvals both ask here.
// The rule that matters for approvals: focus is never put on an Approve button by a rebuild, so a draft that just
// changed hands cannot be approved by a stray Enter or Space.

export type FocusKind = 'approve' | 'edit' | 'reject' | 'body' | 'area' | 'next' | 'copy';
export type FocusTarget = FocusKind | 'heading';

/**
 * `before` is the control that had focus and the draft it belonged to; `after` is the draft now shown and the controls
 * it has (enabled). The same kind of control on the same draft if it still exists, else the heading. Never 'approve'.
 */
export function focusAfterRebuild(
  before: { kind: FocusKind; id: string | undefined } | undefined,
  after: { id: string | undefined; available: readonly FocusKind[] },
): FocusTarget {
  if (!before || before.kind === 'approve') return 'heading';
  if (before.id === undefined || before.id !== after.id) return 'heading';
  return after.available.includes(before.kind) ? before.kind : 'heading';
}
