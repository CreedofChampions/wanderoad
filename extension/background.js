/* Wanderoad extension — the whole service worker.
 *
 * It does two things: open the side panel when the toolbar button is clicked, and register
 * the optional in-page dock when (and only when) the user has switched it on in options.
 *
 * Deliberately absent from the default install: any tabs permission, any host permission,
 * any content script, any network call. The extension cannot see what you are watching, and
 * that is not a promise in a privacy policy — it is the manifest.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    /* Older Chrome does not have setPanelBehavior; the click handler below covers it. */
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error('[wanderoad] could not open the side panel', err);
  }
});

/* The in-page dock is registered from storage rather than declared in the manifest, so a
 * default install genuinely has no content script at all. Turning it on also requires the
 * optional host permission, which Chrome asks for at the moment the user flips the switch. */
async function syncDock() {
  const { dock } = await chrome.storage.sync.get({ dock: false });
  let existing = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts();
  } catch {
    return; // the scripting permission has not been granted, so there is nothing to sync
  }
  const has = existing.some((s) => s.id === 'dock');

  if (dock && !has) {
    await chrome.scripting
      .registerContentScripts([
        {
          id: 'dock',
          matches: ['https://www.youtube.com/*'],
          js: ['dock.js'],
          css: ['dock.css'],
          runAt: 'document_idle',
        },
      ])
      .catch((e) => console.error('[wanderoad] dock registration failed', e));
  } else if (!dock && has) {
    await chrome.scripting.unregisterContentScripts({ ids: ['dock'] }).catch(() => {});
  }
}

chrome.runtime.onStartup.addListener(syncDock);
chrome.runtime.onInstalled.addListener(syncDock);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.dock) syncDock();
});
