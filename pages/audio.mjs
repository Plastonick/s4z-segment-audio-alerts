import { outputsFor } from './core.mjs';
export function createAudio(onStatus) {
  let context;
  let enabled = false;
  function beep(type, volume) {
    const frequencies = type === 'start' ? [880, 1175] : type === 'end' ? [1175, 880, 660] : [740];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.16;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime((volume / 100) * 0.22, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.14);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }
  function speak(text, volume) {
    if (!globalThis.speechSynthesis) {
      onStatus('Speech unavailable; beep controls still work.');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = volume / 100;
    utterance.rate = 1;
    utterance.onerror = (event) => {
      if (!['canceled', 'interrupted'].includes(event.error))
        onStatus(`Speech failed (${event.error}). Try Enable audio again.`);
    };
    // Discard stale speech.
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }
  function playMany(alerts, settings) {
    if (!enabled || context?.state !== 'running') return;
    const speech = [];
    for (const alert of alerts) {
      const output = outputsFor(alert, settings);
      if (output.beep) beep(alert.type, settings.volume);
      if (output.speech) speech.push(output.speech);
    }
    // Combine overlapping warnings to preserve every name.
    if (speech.length) speak(speech.join('. '), settings.volume);
  }
  return {
    async enable(volume) {
      context ||= new AudioContext();
      // Activate both APIs within the user gesture.
      const resumed = context.resume();
      speak('Segment alerts ready', volume);
      await resumed;
      enabled = context.state === 'running';
      context.onstatechange = () => {
        if (context.state !== 'running') {
          enabled = false;
          onStatus('Audio paused by browser. Click Enable audio.');
        }
      };
      if (!enabled) throw new Error('Audio blocked. Click Enable audio again.');
      beep('advance', volume);
      onStatus('Audio enabled');
    },
    pause() {
      enabled = false;
      globalThis.speechSynthesis?.cancel();
      onStatus('Audio paused');
    },
    playMany,
    play(alert, settings) {
      playMany([alert], settings);
    },
    get enabled() {
      return enabled;
    },
  };
}
