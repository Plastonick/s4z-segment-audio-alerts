import { defaults, normalizeSettings, initialState, advance } from './core.mjs';
import { createAdapter } from './adapter.mjs';
import { createAudio } from './audio.mjs';
const $ = (selector) => document.querySelector(selector);
const SETTINGS = 'segment-alerts.settings.v1';
const LEDGER = 'segment-alerts.ledger.v1';
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
let settings = normalizeSettings(read(SETTINGS, defaults));
let state = initialState();
let owner = false;
let lastReceived = 0;
let pending;
let processing = false;
const audio = createAudio((message) => {
  $('#audio-status').textContent = message;
});
for (const [key, value] of Object.entries(settings)) {
  const field = $('#settings').elements.namedItem(key);
  if (typeof value === 'boolean') field.checked = value;
  else field.value = value;
}
$('#volume-label').textContent = `${settings.volume}%`;
$('#settings').addEventListener('input', () => {
  if (!$('#settings').reportValidity()) return;
  settings = normalizeSettings(
    Object.fromEntries(
      Object.keys(defaults).map((key) => {
        const field = $('#settings').elements.namedItem(key);
        return [key, field.type === 'checkbox' ? field.checked : Number(field.value)];
      }),
    ),
  );
  $('#volume-label').textContent = `${settings.volume}%`;
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(settings));
    $('#saved').textContent = 'Settings saved.';
  } catch {
    $('#saved').textContent =
      'Settings work now, but storage is unavailable; they will not survive closing.';
  }
});
$('#enable').onclick = async () => {
  if (!owner) {
    $('#audio-status').textContent =
      'Another Segment Alerts window owns audio. Close it and reopen this window.';
    return;
  }
  try {
    await audio.enable(settings.volume);
  } catch (error) {
    $('#audio-status').textContent = error.message;
  }
};
$('#pause').onclick = () => audio.pause();
for (const button of document.querySelectorAll('[data-test]'))
  button.onclick = () => {
    if (!audio.enabled) {
      $('#audio-status').textContent = 'Click Enable audio before testing.';
      return;
    }
    audio.play(
      { type: button.dataset.test, name: 'Test sprint', seconds: settings.seconds },
      settings,
    );
  };
function log(alert) {
  const list = $('#log');
  if (!list.dataset.started) {
    list.replaceChildren();
    list.dataset.started = 'true';
  }
  const item = document.createElement('li');
  const label = { advance: 'Approaching', start: 'Started', end: 'Finished' }[alert.type];
  item.textContent = `${new Date().toLocaleTimeString()} — ${label}: ${alert.name}${audio.enabled ? '' : ' (audio paused)'}`;
  list.prepend(item);
  while (list.children.length > 12) list.lastChild.remove();
}

async function run() {
  try {
    const common = await import('/pages/src/common.mjs');
    const adapt = createAdapter(common);
    const consume = async (data) => {
      pending = data;
      if (processing) return;
      processing = true;
      try {
        while (pending) {
          const current = pending;
          pending = null;
          const began = Date.now();
          const sample = await adapt(current);
          sample.age += Date.now() - began;
          if (sample.age > 5000 || !Number.isFinite(sample.age)) continue;
          lastReceived = Date.now();
          const result = advance(state, sample, settings);
          state = result.state;
          // Persist first to prevent replay after reload.
          if (owner) {
            try {
              localStorage.setItem(LEDGER, JSON.stringify({ saved: Date.now(), state }));
            } catch {
              /* Keep in-memory deduplication. */
            }
            audio.playMany(result.alerts, settings);
            for (const alert of result.alerts) log(alert);
          }
          $('#connection').textContent = owner
            ? 'Connected to your rider'
            : 'Connected · audio owned by another window';
          $('#mode').textContent = sample.mode;
          const next = sample.upcoming[0];
          $('#next').textContent = next
            ? `${next.name} · ${sample.speed > 0.5 ? `~${Math.round(next.toStart / sample.speed)} sec` : `${Math.round(next.toStart)} m`}`
            : 'No upcoming segment in available data';
        }
      } catch (error) {
        $('#connection').textContent = `Waiting for compatible data: ${error.message}`;
      } finally {
        processing = false;
      }
    };
    await common.subscribe('athlete/self/v2', consume, {
      options: { resources: ['state', 'segments'], stats: false },
    });
    const initial = await common.rpc.getAthleteData('self', {
      version: 2,
      resources: ['state', 'segments'],
      stats: false,
    });
    if (initial) await consume(initial);
  } catch (error) {
    $('#connection').textContent = 'Open this window from Sauce’s window picker.';
    $('#mode').textContent = `Sauce interface unavailable: ${error.message}`;
  }
}
// Atomic ownership prevents duplicate audio across windows.
if (navigator.locks) {
  navigator.locks
    .request('segment-alerts.audio.v1', { ifAvailable: true }, async (lock) => {
      owner = !!lock;
      if (owner) {
        const saved = read(LEDGER, null);
        if (saved?.state?.attempts && saved.state.warned && Date.now() - saved.saved < 6 * 3600_000)
          state = saved.state;
      } else {
        $('#enable').disabled = true;
        $('#audio-status').textContent = 'Audio is managed by another open Segment Alerts window.';
      }
      run();
      if (lock)
        await new Promise((resolve) => addEventListener('pagehide', resolve, { once: true }));
    })
    .catch((error) => {
      $('#audio-status').textContent = `Cannot acquire audio ownership: ${error.message}`;
    });
} else {
  $('#enable').disabled = true;
  $('#audio-status').textContent =
    'Audio needs Chromium Web Locks. Use the native Sauce window or localhost in a current Chromium browser.';
  run();
}
setInterval(() => {
  if (lastReceived && Date.now() - lastReceived > 5000) {
    $('#connection').textContent = 'Rider data paused · waiting to reconnect';
    $('#next').textContent = 'Waiting for fresh rider data';
  }
}, 1000);
