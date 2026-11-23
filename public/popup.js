// Toolbar popup: one "Reader view" switch.
// - On a UG tab page it shows whether the reader is open there and opens or closes it.
// - It also sets the mode for every UG tab: stored as { autoOpen } under "global" in
//   chrome.storage.local (the same key src/storage.ts reads); open tabs follow the change.

const box = document.getElementById('on');
const hint = document.getElementById('hint');

const HINT_ON = 'Every Ultimate Guitar song opens in the reader. Esc goes back to the page for one song.';
const HINT_OFF = 'Ultimate Guitar shows its normal page. Press R on a song to read it once.';

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const global = (await chrome.storage.local.get('global')).global ?? {};
  const mode = global.autoOpen !== false;

  // Only UG pages answer; anywhere else the message fails.
  let state = null;
  try { state = await chrome.tabs.sendMessage(tab.id, { type: 'zxtabs:state' }); } catch { /* not a UG page */ }
  const onSong = !!state?.tabPage;

  box.checked = onSong ? state.open : mode;
  const describe = () => { hint.textContent = box.checked ? HINT_ON : HINT_OFF; };
  describe();

  box.addEventListener('change', async () => {
    describe();
    await chrome.storage.local.set({ global: { ...global, autoOpen: box.checked } });
    if (onSong) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'zxtabs:set', open: box.checked }); } catch { /* tab went away */ }
    }
  });
}

main();
