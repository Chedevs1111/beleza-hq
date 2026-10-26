// The stack of things Esc can close (palette, editor, island, agent card). One global Esc handler asks it what to do.

interface Layer { name: string; close: () => void }

/** Inputs, textareas, selects and contenteditable regions: Esc there belongs to the person typing. */
function isTextTarget(target: EventTarget | null): boolean {
  const t = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!t) return false;
  return t.isContentEditable === true || (typeof t.tagName === 'string' && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export class Layers {
  private readonly stack: Layer[] = [];

  /** Registers an open layer; returns a function that unregisters it (safe to call twice). */
  push(name: string, close: () => void): () => void {
    const layer: Layer = { name, close };
    this.stack.push(layer);
    return () => {
      const i = this.stack.indexOf(layer);
      if (i >= 0) this.stack.splice(i, 1);
    };
  }

  top(): string | undefined {
    return this.stack.at(-1)?.name;
  }

  /**
   * Closes the topmost layer, or calls `home` when none is open. While typing in a field only a palette may close.
   * Returns whether Esc did anything.
   */
  handleEscape(target: EventTarget | null, home: () => void): boolean {
    const top = this.stack.at(-1);
    if (isTextTarget(target) && top?.name !== 'palette') return false;
    if (!top) {
      home();
      return true;
    }
    this.stack.pop();
    top.close();
    return true;
  }
}

/**
 * What the global Esc handler does with the event, given the top layer before `handleEscape` ran and its result.
 * With any layer open the event is stopped, even when refused (typing in a field), so other Esc listeners such as the
 * agent card's own never close a second thing. It is cancelled only when a layer actually closed.
 */
export function escapeDecision(top: string | undefined, handled: boolean): { stop: boolean; prevent: boolean } {
  return { stop: top !== undefined, prevent: top !== undefined && handled };
}
