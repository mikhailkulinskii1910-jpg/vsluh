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
