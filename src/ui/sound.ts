/**
 * Small synthesized sound effects (Web Audio, no files). Muted by default; the audio
 * context is created lazily on the first sound after the user enables sound.
 */
export type SoundName = 'deal' | 'chip' | 'check' | 'fold' | 'turn' | 'win' | 'flip';

let ctx: AudioContext | null = null;
let volume = 0.5;
let enabled = false;

export function setSound(on: boolean, vol = volume) {
  enabled = on;
  volume = Math.max(0, Math.min(1, vol));
  if (on && ctx?.state === 'suspended') void ctx.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, endFreq?: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain * volume, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function noise(start: number, dur: number, gain: number, freq: number) {
  if (!ctx) return;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = gain * volume;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(start);
}

export function play(name: SoundName) {
  if (!enabled) return;
  // created on the first sound after the user has interacted, so the browser lets it start
  if (!ctx && (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive !== false) {
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'deal':
      noise(t, 0.07, 0.35, 2600);
      break;
    case 'flip':
      noise(t, 0.05, 0.25, 3400);
      break;
    case 'chip':
      tone(2300, t, 0.05, 'triangle', 0.18);
      tone(3100, t + 0.035, 0.05, 'triangle', 0.12);
      break;
    case 'check':
      tone(180, t, 0.08, 'sine', 0.35, 120);
      tone(180, t + 0.1, 0.08, 'sine', 0.3, 120);
      break;
    case 'fold':
      noise(t, 0.16, 0.2, 900);
      break;
    case 'turn':
      tone(660, t, 0.18, 'sine', 0.18);
      tone(880, t + 0.12, 0.25, 'sine', 0.16);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.08, 0.22, 'triangle', 0.14));
      break;
  }
}
