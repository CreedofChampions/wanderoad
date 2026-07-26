/* Options. Two settings, both stored in chrome.storage.sync, nothing else. */

const dock = document.getElementById('dock');
const sideRow = document.getElementById('sideRow');

async function paint() {
  const s = await chrome.storage.sync.get({ dock: false, side: 'left' });
  dock.checked = s.dock;
  sideRow.hidden = !s.dock;
  for (const b of sideRow.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.side === s.side);
  }
}

dock.addEventListener('change', async () => {
  if (dock.checked) {
    /* Ask at the moment the user opts in, so Chrome's permission prompt appears with obvious
     * context rather than at install time when it would just look alarming. */
    const ok = await chrome.permissions.request({
      permissions: ['scripting'],
      origins: ['https://www.youtube.com/*'],
    });
    if (!ok) {
      dock.checked = false;
      return;
    }
  }
  await chrome.storage.sync.set({ dock: dock.checked });
  paint();
});

sideRow.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  await chrome.storage.sync.set({ side: b.dataset.side });
  paint();
});

paint();
