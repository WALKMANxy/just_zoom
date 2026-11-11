import { defineContentScript } from 'wxt/utils/define-content-script';
import { startRuntime } from '../src/core/runtime';
import { isContextInvalidationError, markContextInvalid } from '../src/shared/storage';
import { guardOrphanedContext } from '../src/core/context-lifecycle';
import { installDebugChannel } from '../src/shared/debug';
import { installDrmProbe } from '../src/features/drm-probe';

export default defineContentScript({
  matches: ['<all_urls>'], allFrames: true, matchAboutBlank: true, runAt: 'document_idle',
  main(ctx) {
    let dispose = () => {};
    guardOrphanedContext(() => {
      markContextInvalid();
      ctx.abort();
    });
    ctx.onInvalidated(() => {
      markContextInvalid();
      // WXT invalidates older injections synchronously. Teardown is idempotent,
      // so repeated abort notifications cannot leave listeners running.
      try { dispose(); }
      catch (error) {
        // Chrome API listener removal can throw after an extension reload.
        if (!isContextInvalidationError(error)) throw error;
      }
    });
    const stopRuntime = startRuntime();
    const stopDebug = installDebugChannel();
    const stopProbe = installDrmProbe();
    dispose = () => { stopProbe(); stopDebug(); stopRuntime(); };
  },
});
