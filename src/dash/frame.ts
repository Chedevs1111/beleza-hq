// Where the 3D office sits in the window. Glass panels cover the edges; the picture is slid so its centre lands in the
// clear middle, which keeps the Core, the loft and the steps out from under them.

export interface ViewInsets {
  width: number;
  height: number;
  /** Pixels covered by glass on each side. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface WorldFrame { dx: number; dy: number; zoom: number }

const px = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** The shift `parts.setFrame` wants: half the difference between opposite insets (a left panel pushes the picture right). */
export function frameFor(v: ViewInsets): WorldFrame {
  return { dx: (px(v.left) - px(v.right)) / 2, dy: (px(v.top) - px(v.bottom)) / 2, zoom: 1 };
}

/** The views are composed for a landscape window; in a tall one the picture is zoomed out so the room still fits across. */
export function viewZoom(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(1, Math.max(0.5, width / height / 1.3));
}

export interface Box { top: number; right: number; bottom: number; left: number }

/**
 * The insets for the Home view. The sidebar covers the left edge on a wide window; on a phone it is a tab bar along the
 * bottom edge (its right edge is nearly the window width, so reading it as a left panel would push the picture off
 * screen) and it covers the bottom with the team bar, whichever reaches higher.
 */
export function homeInsets(o: {
  width: number;
  height: number;
  phone: boolean;
  /** Width the agent card covers at the right. */
  right: number;
  sidebar: Box;
  island: Box | null;
  team: Box | null;
}): ViewInsets {
  const fromBottom = (b: Box | null): number => (b ? o.height - b.top : 0);
  return {
    width: o.width,
    height: o.height,
    left: o.phone ? 0 : o.sidebar.right,
    right: o.right,
    top: o.island ? o.island.bottom : 0,
    bottom: Math.max(fromBottom(o.team), o.phone ? fromBottom(o.sidebar) : 0),
  };
}
