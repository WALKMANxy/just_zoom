import { isContextInvalidationError } from '../shared/storage';

/**
 * Suppresses unhandled Chromium MV3 invalidation errors that occur when
 * extension contexts reload or update while callbacks are still queued in the host page.
 */
export function guardOrphanedContext(invalidate: () => void): void {
  let stopped = false;
  const suppressOrphan = (event: Event, error: unknown) => {
    if (!isContextInvalidationError(error)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!stopped) {
      stopped = true;
      invalidate();
    }
  };
  // Intentionally survive runtime disposal: Chrome can deliver callbacks that were
  // already queued in the page task queue before extension invalidation. The document
  // retains these listeners until navigation; unrelated page errors still report normally.
  window.addEventListener('error', event => {
    suppressOrphan(event, event.error ?? event.message);
  }, true);
  window.addEventListener('unhandledrejection', event => {
    suppressOrphan(event, event.reason);
  }, true);
}
