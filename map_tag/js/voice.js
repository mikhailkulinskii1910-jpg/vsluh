// Голосовой чат в реальном времени.
// 1) Напрямую: WebRTC между всеми участниками голосового канала (сигнализация — через зашифрованную комнату).
// 2) Запасной путь, если напрямую не соединилось за 10 с (мобильный NAT): поток opus-кусочков по 300 мс
//    через ту же комнату, проигрывание через MediaSource. Задержка ~1 с, работает в любой сети.
import { t } from './i18n.js';

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:global.stun.twilio.com:3478' }];
const RELAY_AFTER = 10000, SLICE = 300, SESSION_MS = 15000;
const MSE_TYPE = 'audio/webm; codecs="opus"';

export const VOICE = { on: false, room: null, mic: true, peers: new Map(), speaking: new Set(), onChange: null };
let ctx = null;  // { send(type, data, to), myId(), myName(), myRole(), toast }
let stream = null, rec = null, sessionTimer = 0, vadTimer = 0, actx = null;
const remote = new Map(); // id → { ms, sb, queue, audio, sid }

export function voiceInit(c) { ctx = c; }
const changed = () => VOICE.onChange && VOICE.onChange();
function iceServers() {
  const list = [...STUN];
  try { const tu = JSON.parse(localStorage.getItem('mt_turn') || 'null'); if (tu && tu.url) list.push({ urls: tu.url, username: tu.user || '', credential: tu.pass || '' }); } catch {}
  return list;
}
const forceRelay = () => { try { return localStorage.getItem('mt_voice_relay') === '1'; } catch { return false; } };
export const voiceRoomFor = (ch) => (ch === 'team' ? 'team:' + ctx.myRole() : 'all');

// ---------- вход / выход ----------
export async function voiceJoin(ch) {
  if (VOICE.on) await voiceLeave();
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { ctx.toast(t('chatNoMic')); return false; }
  VOICE.on = true; VOICE.room = voiceRoomFor(ch); VOICE.ch = ch; VOICE.mic = true;
  stream.getAudioTracks().forEach((tr) => { tr.enabled = true; });
  startVad();
  ctx.send('vjoin', { room: VOICE.room, name: ctx.myName() });
  changed();
  return true;
}
export async function voiceLeave() {
  if (!VOICE.on) return;
  ctx.send('vleave', { room: VOICE.room });
  for (const id of [...VOICE.peers.keys()]) dropPeer(id);
  stopRelay();
  clearInterval(vadTimer);
  if (stream) stream.getTracks().forEach((x) => x.stop());
  stream = null; VOICE.on = false; VOICE.room = null; VOICE.speaking.clear();
  changed();
}
export function voiceMute(on) {
  VOICE.mic = on != null ? on : !VOICE.mic;
  if (stream) stream.getAudioTracks().forEach((tr) => { tr.enabled = VOICE.mic; });
  if (!VOICE.mic) stopRelay(); else maybeRelay();
  changed();
}

// ---------- пиры ----------
function mkPeer(id, name) {
  if (VOICE.peers.has(id)) return VOICE.peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  const peer = { id, name, pc, state: 'connecting', relay: false, audio: null, t0: Date.now() };
  VOICE.peers.set(id, peer);
  if (stream) stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
  pc.onicecandidate = (e) => { if (e.candidate) ctx.send('vsig', { room: VOICE.room, ice: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }, id); };
  pc.ontrack = (e) => {
    if (!peer.audio) { peer.audio = new Audio(); peer.audio.autoplay = true; peer.audio.playsInline = true; }
    peer.audio.srcObject = e.streams[0]; peer.audio.play().catch(() => {});
    watchLevel(id, e.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') { peer.state = 'direct'; peer.relay = false; }
    if (s === 'failed') goRelay(peer);
    changed();
  };
  peer.relayTimer = setTimeout(() => { if (peer.state !== 'direct') goRelay(peer); }, forceRelay() ? 1500 : RELAY_AFTER);
  changed();
  return peer;
}
function goRelay(peer) {
  if (!VOICE.peers.has(peer.id) || peer.relay) return;
  peer.relay = true; peer.state = 'relay';
  ctx.send('vrelay', { room: VOICE.room }, peer.id);
  maybeRelay(); changed();
}
function dropPeer(id) {
  const p = VOICE.peers.get(id); if (!p) return;
  clearTimeout(p.relayTimer);
  try { p.pc.close(); } catch {}
  if (p.audio) { p.audio.srcObject = null; }
  VOICE.peers.delete(id); VOICE.speaking.delete(id);
  const r = remote.get(id); if (r) { try { r.audio.pause(); } catch {} remote.delete(id); }
  maybeRelay(); changed();
}
async function makeOffer(peer) {
  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  ctx.send('vsig', { room: VOICE.room, sdp: peer.pc.localDescription }, peer.id);
}

/** Сообщения голосового канала из комнаты. */
export async function voiceHandle(type, d, from) {
  if (!VOICE.on || !d || d.room !== VOICE.room) return;
  const me = ctx.myId();
  if (type === 'vjoin' || type === 'vhere') {
    if (type === 'vjoin') ctx.send('vhere', { room: VOICE.room, name: ctx.myName() }, from);
    const peer = mkPeer(from, d.name);
    if (forceRelay()) return;
    if (me < from && !peer.offered) { peer.offered = true; makeOffer(peer).catch(() => {}); }   // предлагает тот, чей id меньше
  } else if (type === 'vsig') {
    const peer = mkPeer(from, d.name);
    try {
      if (d.sdp) {
        await peer.pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') { const ans = await peer.pc.createAnswer(); await peer.pc.setLocalDescription(ans); ctx.send('vsig', { room: VOICE.room, sdp: peer.pc.localDescription }, from); }
        for (const c of peer.pendingIce || []) await peer.pc.addIceCandidate(c).catch(() => {});
        peer.pendingIce = [];
      } else if (d.ice) {
        if (!peer.pc.remoteDescription) (peer.pendingIce = peer.pendingIce || []).push(d.ice);
        else await peer.pc.addIceCandidate(d.ice).catch(() => {});
      }
    } catch {}
  } else if (type === 'vrelay') { const p = VOICE.peers.get(from); if (p) goRelay(p); }
  else if (type === 'vleave') dropPeer(from);
  else if (type === 'vchunk') playChunk(from, d);
  else if (type === 'vtalk') { if (d.on) VOICE.speaking.add(from); else VOICE.speaking.delete(from); changed(); }
}

// ---------- запасной путь: поток через сервер ----------
function maybeRelay() {
  const need = VOICE.on && VOICE.mic && [...VOICE.peers.values()].some((p) => p.relay);
  if (need && !rec) startRelay(); else if (!need && rec) stopRelay();
}
function startRelay() {
  if (!stream || !window.MediaRecorder) return;
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const session = () => {
    // новая «сессия» каждые 15 с: в первом кусочке заголовок, по нему подключаются опоздавшие
    if (rec) { try { rec.mr.stop(); } catch {} }
    const sid = Math.random().toString(36).slice(2, 8);
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 16000 } : { audioBitsPerSecond: 16000 });
    let seq = 0;
    mr.ondataavailable = async (e) => {
      if (!e.data || !e.data.size || !VOICE.on) return;
      const b = new Uint8Array(await e.data.arrayBuffer());
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      ctx.send('vchunk', { room: VOICE.room, sid, seq: seq++, a: btoa(s) });
    };
    mr.start(SLICE);
    rec = { mr, sid };
  };
  session();
  sessionTimer = setInterval(session, SESSION_MS);
}
function stopRelay() { clearInterval(sessionTimer); if (rec) { try { rec.mr.stop(); } catch {} rec = null; } }

function playChunk(from, d) {
  const p = VOICE.peers.get(from);
  if (p && p.state === 'direct') return;            // напрямую уже слышим
  if (!window.MediaSource || !MediaSource.isTypeSupported(MSE_TYPE)) return;
  let r = remote.get(from);
  if (!r || r.sid !== d.sid) {
    if (d.seq !== 0) return;                        // ждём начала новой сессии (заголовок)
    if (r) { try { r.audio.pause(); } catch {} }
    const ms = new MediaSource(), audio = new Audio();
    audio.src = URL.createObjectURL(ms); audio.autoplay = true;
    r = { sid: d.sid, ms, sb: null, queue: [], audio, next: 0 };
    remote.set(from, r);
    ms.addEventListener('sourceopen', () => { r.sb = ms.addSourceBuffer(MSE_TYPE); r.sb.mode = 'sequence'; r.sb.addEventListener('updateend', () => pump(r)); pump(r); });
    audio.play().catch(() => {});
  }
  if (d.seq < r.next) return;
  const bin = atob(d.a), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  r.queue.push(u); r.next = d.seq + 1; r.bytes = (r.bytes || 0) + u.length;
  VOICE.speaking.add(from); clearTimeout(r.quiet); r.quiet = setTimeout(() => { VOICE.speaking.delete(from); changed(); }, 900); changed();
  pump(r);
}
function pump(r) {
  if (!r.sb || r.sb.updating || !r.queue.length) return;
  try {
    r.sb.appendBuffer(r.queue.shift());
    const a = r.audio, b = a.buffered;
    if (b.length && b.end(b.length - 1) - a.currentTime > 1.5) a.currentTime = b.end(b.length - 1) - 0.3;   // не копим задержку
  } catch {}
}

// ---------- кто говорит ----------
function level(an) { const d = new Uint8Array(an.fftSize); an.getByteTimeDomainData(d); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v - 128)); return m; }
function startVad() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  const src = actx.createMediaStreamSource(stream), an = actx.createAnalyser(); an.fftSize = 512; src.connect(an);
  let talking = false;
  vadTimer = setInterval(() => {
    const on = VOICE.mic && level(an) > 14;
    if (on !== talking) { talking = on; on ? VOICE.speaking.add('me') : VOICE.speaking.delete('me'); ctx.send('vtalk', { room: VOICE.room, on }); changed(); }
  }, 250);
}
function watchLevel(id, s) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const an = actx.createAnalyser(); an.fftSize = 512; actx.createMediaStreamSource(s).connect(an);
    const p = VOICE.peers.get(id); if (p) p.an = an;
  } catch {}
}
/** Для тестов и индикаторов: сколько аудио реально пришло от каждого. */
export async function voiceStats() {
  const out = {};
  for (const [id, p] of VOICE.peers) {
    let bytes = 0;
    try { (await p.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') bytes += r.bytesReceived || 0; }); } catch {}
    out[id] = { state: p.state, rtpBytes: bytes, relayBytes: (remote.get(id) || {}).bytes || 0 };
  }
  return out;
}
