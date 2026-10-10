import { Component, createRef, type HTMLAttributes } from "react";

/** Capture focus before React removes a review control. Polling must not move
 * focus from another part of the page or scroll the conversation. */
export class StableReviewFocus extends Component<HTMLAttributes<HTMLElement>, {}, Element | null> {
  private readonly section = createRef<HTMLElement>();

  getSnapshotBeforeUpdate(): Element | null {
    const root = this.section.current;
    const active = root?.ownerDocument.activeElement ?? null;
    return root && active !== root && root.contains(active) ? active : null;
  }

  componentDidUpdate(_previousProps: HTMLAttributes<HTMLElement>, _previousState: {}, snapshot: Element | null) {
    if (this.section.current) restoreRemovedReviewFocus(this.section.current, snapshot);
  }

  render() {
    return <section {...this.props} ref={this.section} tabIndex={-1} />;
  }
}

/** Restore only a control removed by this update, while the page still owns
 * focus. An existing control or a newly focused external element wins. */
export function restoreRemovedReviewFocus(root: HTMLElement, snapshot: Element | null): void {
  const document = root.ownerDocument;
  if (snapshot && !snapshot.isConnected && document.activeElement === document.body && document.hasFocus()) {
    root.focus({ preventScroll: true });
  }
}
