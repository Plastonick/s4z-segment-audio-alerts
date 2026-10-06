export const defaults = Object.freeze({
  seconds: 20,
  advanceBeep: true,
  announce: true,
  startBeep: true,
  endBeep: true,
  volume: 65,
});
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
export function normalizeSettings(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof fallback === 'boolean'
        ? typeof v[key] === 'boolean'
          ? v[key]
          : fallback
        : finite(v[key])
          ? Math.min(key === 'seconds' ? 300 : 100, Math.max(key === 'seconds' ? 1 : 0, v[key]))
          : fallback,
    ]),
  );
}
export const initialState = () => ({
  session: null,
  time: null,
  received: null,
  attempts: {},
  warned: {},
  context: null,
  position: null,
  visit: 0,
});

// Consume muted alerts to avoid replay on activation.
export function advance(previous, sample, settings, now = Date.now()) {
  if (
    !sample ||
    !finite(sample.time) ||
    !finite(sample.age) ||
    sample.age > 5000 ||
    sample.age < 0 ||
    !Array.isArray(sample.attempts)
  )
    return { state: previous, alerts: [] };
  const changed = previous.session !== sample.session;
  const old = changed ? initialState() : previous;
  if (old.time !== null && sample.time <= old.time) return { state: old, alerts: [] };
  // Reconnects must not replay missed finishes.
  const baseline = old.time === null || now - old.received > 5000;
  const state = {
    ...old,
    session: sample.session,
    time: sample.time,
    received: now,
    attempts: { ...old.attempts },
    warned: { ...old.warned },
  };
  const alerts = [];
  for (const attempt of sample.attempts) {
    const before = old.attempts[attempt.key];
    if (!baseline && !before && attempt.active) alerts.push({ type: 'start', name: attempt.name });
    if (!baseline && before?.active && !attempt.active && !attempt.incomplete)
      alerts.push({ type: 'end', name: attempt.name });
    state.attempts[attempt.key] = { active: attempt.active };
  }
  state.attempts = Object.fromEntries(sample.attempts.map((x) => [x.key, state.attempts[x.key]]));
  const contextChanged = sample.context !== null && old.context !== sample.context;
  const rewind =
    finite(old.position) && finite(sample.position) && sample.position < old.position - 100;
  if (contextChanged || rewind) state.visit++;
  // Preserve visit identity across metadata outages.
  if (sample.context !== null) {
    state.context = sample.context;
    state.position = sample.position;
  }
  for (const segment of sample.upcoming || []) {
    const key = JSON.stringify([sample.context, state.visit, segment.key]);
    const eta =
      finite(sample.speed) && sample.speed > 0.5 ? segment.toStart / sample.speed : Infinity;
    if (segment.toStart > 0 && eta <= settings.seconds && !state.warned[key]) {
      state.warned[key] = now;
      alerts.push({ type: 'advance', name: segment.name, seconds: Math.max(1, Math.round(eta)) });
    }
  }
  state.warned = Object.fromEntries(Object.entries(state.warned).slice(-1000));
  return { state, alerts };
}
export function outputsFor(alert, settings) {
  return {
    beep:
      settings[{ advance: 'advanceBeep', start: 'startBeep', end: 'endBeep' }[alert.type]] === true,
    speech:
      alert.type === 'advance' && settings.announce
        ? `${alert.name} in about ${alert.seconds} seconds`
        : null,
  };
}
