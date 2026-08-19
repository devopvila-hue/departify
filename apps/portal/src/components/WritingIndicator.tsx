import type { ReactElement } from "react";

/**
 * Hotfix — minimal writing indicator.
 *
 * Replaces the Sprint 64/65 streaming pipeline bubble. The backend
 * continues to push `content_delta` frames internally (transport-only
 * pacing signal), but the chat surface does NOT render them as text.
 * The CSS animates three dots with a staggered opacity pulse so the
 * CEO sees that Departify is working, without any rotating activity
 * label and without any intermediate assistant bubble.
 *
 * `prefers-reduced-motion: reduce` short-circuits the animation to a
 * static dot row.
 */
export function WritingIndicator(): ReactElement {
  return (
    <div
      className="dfy-chat-writing"
      role="status"
      aria-live="polite"
      aria-label="Escribiendo"
      data-testid="chat-writing-indicator"
    >
      <span className="dfy-chat-writing__dot" aria-hidden="true" />
      <span className="dfy-chat-writing__dot" aria-hidden="true" />
      <span className="dfy-chat-writing__dot" aria-hidden="true" />
      <span className="dfy-chat-writing__label">Escribiendo…</span>
    </div>
  );
}
