/**
 * sound.js
 * All game audio is synthesized with the Web Audio API — no audio files to
 * fetch or ship. Every event gets its own short, distinct tone or motif.
 * The AudioContext is created lazily on the first user gesture (browsers
 * block audio otherwise), and everything fails silently if Web Audio isn't
 * available so a missing/blocked API never breaks the game itself.
 */

const Sound = (() => {
  let ctx = null;
  let muted = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { ctx = new Ctx(); } catch (e) { return null; }
    return ctx;
  }

  // Any click/tap anywhere primes the AudioContext (and resumes it if a
  // previous tab-switch suspended it), so the first real game sound isn't lost.
  function prime() {
    const c = ensureCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }
  ["pointerdown", "keydown"].forEach((evt) =>
    document.addEventListener(evt, prime, { once: false, passive: true })
  );

  // One oscillator "note": frequency envelope from f0 -> f1 over `dur` seconds,
  // with a quick attack and an exponential-ish release so nothing clicks or pops.
  function tone(f0, dur, { type = "sine", f1 = f0, gain = 0.16, delay = 0 } = {}) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur / 4));
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // A short sequence of notes, e.g. for win/lose motifs.
  function sequence(notes) {
    notes.forEach((n) => tone(n.f0, n.dur, n));
  }

  const sounds = {
    // A soft, neutral footstep-like blip — used for every police/thief move.
    move: () => tone(220, 0.07, { type: "triangle", f1: 180, gain: 0.11 }),

    // Quick high tick — plays once per second while a turn is about to expire.
    turnTick: () => tone(1000, 0.05, { type: "square", gain: 0.08 }),

    // Lower double-beep — plays once as the match clock crosses into its last 30s.
    matchLow: () =>
      sequence([
        { f0: 520, dur: 0.11, type: "square", gain: 0.14 },
        { f0: 520, dur: 0.11, type: "square", gain: 0.14, delay: 0.16 },
      ]),

    // Police items
    indicator: () => sequence([
      { f0: 700, dur: 0.16, f1: 1200, type: "sine", gain: 0.14 },
      { f0: 700, dur: 0.16, f1: 1200, type: "sine", gain: 0.1, delay: 0.13 },
    ]),
    jump: () => sequence([
      { f0: 300, dur: 0.09, f1: 520, type: "square", gain: 0.13 },
      { f0: 460, dur: 0.11, f1: 760, type: "square", gain: 0.13, delay: 0.08 },
    ]),

    // Thief items
    stopper: () => tone(420, 0.32, { type: "sawtooth", f1: 90, gain: 0.15 }),
    teleport: () => sequence([
      { f0: 300, dur: 0.05, f1: 900, type: "sine", gain: 0.1 },
      { f0: 500, dur: 0.05, f1: 1400, type: "sine", gain: 0.1, delay: 0.05 },
      { f0: 700, dur: 0.14, f1: 1800, type: "sine", gain: 0.12, delay: 0.1 },
    ]),

    // Match end
    capture: () => sequence([
      { f0: 440, dur: 0.12, type: "square", gain: 0.16 },
      { f0: 554, dur: 0.12, type: "square", gain: 0.16, delay: 0.1 },
      { f0: 659, dur: 0.22, type: "square", gain: 0.18, delay: 0.2 },
    ]),
    thiefWin: () => sequence([
      { f0: 392, dur: 0.1, type: "triangle", gain: 0.15 },
      { f0: 494, dur: 0.1, type: "triangle", gain: 0.15, delay: 0.09 },
      { f0: 587, dur: 0.1, type: "triangle", gain: 0.15, delay: 0.18 },
      { f0: 784, dur: 0.26, type: "triangle", gain: 0.18, delay: 0.27 },
    ]),
  };

  function play(name) {
    const fn = sounds[name];
    if (fn) fn();
  }

  function setMuted(v) { muted = v; }
  function isMuted() { return muted; }

  return { play, setMuted, isMuted };
})();
