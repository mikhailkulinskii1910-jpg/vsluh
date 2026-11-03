// Короткие звуковые сигналы игры (WebAudio, без файлов). Выключаются в настройках.
let ctx = null;
export const soundOn = () => { try { return localStorage.getItem('mt_sound') !== '0'; } catch { return true; } };
export const setSound = (on) => { try { localStorage.setItem('mt_sound', on ? '1' : '0'); } catch {} };
const PATTERNS = {
  red: [[880, 0.12], [660, 0.12], [880, 0.18]],     // вас засекли / поймали
  yellow: [[740, 0.1], [988, 0.16]],                // задание, предупреждение
  green: [[660, 0.08], [990, 0.14]],                // подобрано, успех
  blue: [[520, 0.1], [780, 0.12]],                  // способность сработала
};
export function beep(kind) {
  if (!soundOn()) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    let t = ctx.currentTime + 0.01;
    for (const [f, d] of PATTERNS[kind] || PATTERNS.blue) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.02);
      t += d + 0.04;
    }
  } catch {}
}

// ---------- звуковые приколы (синтез, без файлов) ----------
export const FX = ['horn', 'quack', 'drum', 'boo', 'clap', 'fart'];
export function playFx(name) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const T = ctx.currentTime + 0.01, out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination);
    const tone = (type, f0, f1, t0, d, g = 0.6) => {
      const o = ctx.createOscillator(), gg = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, T + t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), T + t0 + d);
      gg.gain.setValueAtTime(0.0001, T + t0); gg.gain.exponentialRampToValueAtTime(g, T + t0 + 0.02); gg.gain.exponentialRampToValueAtTime(0.0001, T + t0 + d);
      o.connect(gg).connect(out); o.start(T + t0); o.stop(T + t0 + d + 0.05);
    };
    const noise = (t0, d, g, freq) => {
      const len = Math.ceil(ctx.sampleRate * d), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gg = ctx.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq || 1200; gg.gain.value = g;
      src.connect(f).connect(gg).connect(out); src.start(T + t0);
    };
    switch (name) {
      case 'horn': tone('sawtooth', 440, 440, 0, 0.7, 0.5); tone('sawtooth', 554, 554, 0, 0.7, 0.4); tone('sawtooth', 659, 659, 0, 0.7, 0.3); break;
      case 'quack': tone('square', 900, 500, 0, 0.12, 0.4); tone('square', 850, 450, 0.16, 0.14, 0.4); break;
      case 'drum': noise(0, 0.12, 0.8, 200); noise(0.18, 0.12, 0.8, 300); noise(0.36, 0.5, 0.6, 6000); break;
      case 'boo': tone('sine', 300, 120, 0, 1.0, 0.6); tone('triangle', 310, 125, 0, 1.0, 0.3); break;
      case 'clap': for (let i = 0; i < 8; i++) noise(i * 0.09 + Math.random() * 0.03, 0.06, 0.7, 1500); break;
      case 'fart': tone('sawtooth', 110, 60, 0, 0.6, 0.6); noise(0, 0.6, 0.3, 150); break;
    }
  } catch {}
}
