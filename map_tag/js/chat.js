// Чат и рация (групповые голосовые сообщения) для онлайн-игры.
// Идут через ту же зашифрованную комнату, что и игра. Каналы: «Все» и «Команда».
import { t, getLang } from './i18n.js';
import { I } from './icons.js';
import { beep, FX, playFx } from './sound.js';
import { VOICE, voiceJoin, voiceLeave, voiceMute } from './voice.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAX_REC = 15;            // секунд на одно сообщение рации
const QUICK = {
  ru: ['Я на месте', 'Вижу охотника!', 'Бегу к заданию', 'Помогите!', 'Тут чисто', 'Иду к вам', '👍', '😂'],
  en: ['In position', 'Hunter spotted!', 'Going for the mission', 'Help!', 'All clear', 'Coming to you', '👍', '😂'],
};

export const CHAT = { msgs: [], unread: 0, ch: 'all', open: null, autoplay: true };
try { CHAT.autoplay = localStorage.getItem('mt_autoplay') !== '0'; } catch {}

let ctx = null;   // { send(data), me(): { id, name, role }, inGame(): game|null, toast }
export function chatInit(c) { ctx = c; }
export function chatReset() { CHAT.msgs = []; CHAT.unread = 0; }

const visible = (m) => m.ch === 'all' || m.team === ctx.me().role || m.from === ctx.me().id;

/** Сообщение из сети. */
export function chatHandle(d, from) {
  if (!d || !d.id || CHAT.msgs.some((m) => m.id === d.id)) return;
  const m = { ...d, from, at: Date.now() };
  if (!visible(m)) return;
  CHAT.msgs.push(m); if (CHAT.msgs.length > 200) CHAT.msgs.shift();
  const g = ctx.inGame();
  if (m.kind === 'voice' && CHAT.autoplay) playVoice(m);
  if (m.kind === 'fx') playFx(m.fx);
  if (m.kind === 'sos') { [0, 900, 1800].forEach((d) => setTimeout(() => playFx('horn'), d)); try { navigator.vibrate && navigator.vibrate([500, 200, 500, 200, 500]); } catch {} if (g && g.showPing && m.x != null) g.showPing(m.x, m.y, '🆘 ' + m.name); }
  if (m.kind === 'loc' && g && g.showPing) g.showPing(m.x, m.y, m.here ? `${m.name}: ${t('pingHere')}` : m.name);
  if (CHAT.open) CHAT.open.redraw();
  else {
    CHAT.unread++;
    const txt = m.kind === 'sos' ? `🆘 SOS — ${t('sosMsg')}` : m.kind === 'voice' ? `🎙 ${t('chatVoice')}` : m.kind === 'loc' ? `📍 ${t('chatLoc')}` : m.kind === 'fx' ? FX_ICON[m.fx] + ' ' + t('fx_' + m.fx) : m.text;
    const label = `${m.ch === 'team' ? '[' + t('chatTeam') + '] ' : ''}${m.name}: ${txt}`;
    if (g) { g.alert('blue', label, 'mail'); g.renderHud(true); } else { ctx.toast(label); beep('blue'); }
    ctx.onUnread && ctx.onUnread();
  }
}

function post(data) {
  if (ctx.canTalk && !ctx.canTalk()) { ctx.toast(t('deadMute')); return; }
  const me = ctx.me();
  const m = { id: Math.random().toString(36).slice(2, 10), name: me.name, ch: CHAT.ch, team: me.role, ...data };
  ctx.send(m);
  CHAT.msgs.push({ ...m, from: me.id, at: Date.now() });
  if (CHAT.open) CHAT.open.redraw();
}
const FX_ICON = { horn: '📯', quack: '🦆', drum: '🥁', boo: '👻', clap: '👏', fart: '💨' };
export const sendFx = (fx) => { playFx(fx); post({ kind: 'fx', fx }); };
export const sendSos = (x, y, link) => post({ kind: 'sos', x, y, link, ch: 'all' });
export const sendText = (text) => { text = String(text).trim().slice(0, 300); if (text) post({ kind: 'text', text }); };

// ---------- рация ----------
let rec = null;
function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return opts.find((x) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x)) || '';
}
export async function recStart(onTick) {
  if (rec) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { ctx.toast(t('chatNoMic')); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { ctx.toast(t('chatNoMic')); return; }
  const mime = pickMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 16000 } : { audioBitsPerSecond: 16000 });
  const chunks = [];
  rec = { mr, stream, chunks, t0: Date.now(), cancel: false };
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    stream.getTracks().forEach((x) => x.stop());
    const r = rec; rec = null;
    clearInterval(r.timer);
    const dur = (Date.now() - r.t0) / 1000;
    if (r.cancel || dur < 0.5 || !chunks.length) return;
    const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
    const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    post({ kind: 'voice', a: b64, mime: blob.type, dur: Math.round(dur * 10) / 10 });
  };
  mr.start();
  rec.timer = setInterval(() => { const s = (Date.now() - rec.t0) / 1000; onTick && onTick(s); if (s >= MAX_REC) recStop(); }, 200);
  beep('green');
}
export function recStop(cancel) { if (!rec) return; rec.cancel = !!cancel; try { rec.mr.stop(); } catch {} }
export const recording = () => !!rec;

let playing = null;
export function playVoice(m) {
  try {
    if (playing) playing.pause();
    const a = new Audio(`data:${m.mime || 'audio/webm'};base64,${m.a}`);
    playing = a; a.play().catch(() => {});
  } catch {}
}

/** «Сюда!»: метка в любой точке карты (долгое нажатие) — только своей команде. */
export function sendPing(x, y) {
  if (!ctx.inGame()) return;
  post({ kind: 'loc', x, y, ch: 'team', here: 1 });
  const g = ctx.inGame(); g.showPing(x, y, t('pingHere'));
}

/** «Где я»: точка на карте у собеседников на 30 секунд (только в игре). */
export function sendLoc() {
  const g = ctx.inGame(); if (!g) return;
  post({ kind: 'loc', x: Math.round(g.me.x), y: Math.round(g.me.y), ch: 'team' });   // место — только своей команде
  ctx.toast(t('chatLocSent'));
}

// ---------- окно чата ----------
export function openChat(modal) {
  CHAT.unread = 0; ctx.onUnread && ctx.onUnread();
  modal('', (box, close) => {
    const fmtT = (ms) => new Date(ms).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
    const draw = () => {
      const me = ctx.me(), g = ctx.inGame();
      const list = CHAT.msgs.filter((m) => (CHAT.ch === 'all' ? m.ch === 'all' : m.ch === 'team' && (m.team === me.role || m.from === me.id)));
      box.innerHTML = `<div class="mhead"><span class="k">${t('chat')}</span><button class="icon-btn" data-x>${I.close}</button></div>
        ${voiceBar(me)}
        <div class="seg" style="display:flex;margin-bottom:10px"><button data-ch="all" class="${CHAT.ch === 'all' ? 'on' : ''}" style="flex:1">${t('chatAll')}</button><button data-ch="team" class="${CHAT.ch === 'team' ? 'on' : ''}" style="flex:1">${t('chatTeam')}: ${t(me.role === 'hunter' ? 'huntersPl' : 'hidersPl')}</button></div>
        <div class="chat-list" id="chList">${list.length ? list.map((m) => `<div class="msg ${m.from === me.id ? 'mine' : ''}"><div class="who">${esc(m.name)} · ${fmtT(m.at)}</div>
          ${m.kind === 'voice' ? `<button class="vmsg" data-play="${m.id}">${I.play}<span>${t('chatVoice')} · ${m.dur}${t('sec')}</span></button>` : m.kind === 'loc' ? `<div class="bub">📍 ${t('chatLoc')}</div>` : m.kind === 'sos' ? `<div class="bub sos">🆘 SOS — ${t('sosMsg')}${m.link ? `<br><a href="${esc(m.link)}" target="_blank" rel="noopener">${t('sosMap')}</a>` : ''}</div>` : m.kind === 'fx' ? `<div class="bub" style="font-size:22px">${FX_ICON[m.fx] || '🔊'} <span style="font-size:14px">${t('fx_' + m.fx)}</span></div>` : `<div class="bub">${esc(m.text)}</div>`}</div>`).join('') : `<div class="empty" style="padding:20px">${t('chatEmpty')}</div>`}</div>
        <div class="chips quick">${(QUICK[getLang()] || QUICK.ru).map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <div class="fxrow">${FX.map((f) => `<button class="fxb" data-fx="${f}" title="${t('fx_' + f)}">${FX_ICON[f]}</button>`).join('')}</div>
        <div class="chat-in"><input class="input" id="chText" maxlength="300" placeholder="${t('chatPh')}" enterkeyhint="send"><button class="btn primary" id="chSend">${I.arrowR}</button></div>
        <div class="row" style="margin-top:10px;flex-wrap:nowrap">
          <button class="btn ptt" id="ptt">🎙 <span id="pttT">${t('chatHold')}</span></button>
          ${g ? `<button class="btn" id="chLoc" style="flex:none">📍 ${t('chatWhere')}</button>` : ''}
        </div>
        <label class="row" style="margin-top:10px;color:var(--muted);font-size:14px;gap:8px;flex-wrap:nowrap"><input type="checkbox" id="chAuto" ${CHAT.autoplay ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">${t('chatAutoplay')}</label>`;
      const lst = box.querySelector('#chList'); lst.scrollTop = lst.scrollHeight;
      const vj = box.querySelector('#vJoin'); if (vj) vj.onclick = async () => { vj.disabled = true; await voiceJoin(CHAT.ch); draw(); };
      const vm = box.querySelector('#vMic'); if (vm) vm.onclick = () => { voiceMute(); };
      const vl = box.querySelector('#vLeave'); if (vl) vl.onclick = () => { voiceLeave(); };
      box.querySelector('[data-x]').onclick = () => { CHAT.open = null; recStop(true); close(); };
      box.querySelectorAll('[data-ch]').forEach((b) => b.onclick = () => { CHAT.ch = b.dataset.ch; draw(); });
      box.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => sendText(b.dataset.q));
      box.querySelectorAll('[data-fx]').forEach((b) => b.onclick = () => sendFx(b.dataset.fx));
      box.querySelectorAll('[data-play]').forEach((b) => b.onclick = () => { const m = CHAT.msgs.find((x) => x.id === b.dataset.play); if (m) playVoice(m); });
      const inp = box.querySelector('#chText');
      const go = () => { sendText(inp.value); inp.value = ''; };
      box.querySelector('#chSend').onclick = go;
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      const loc = box.querySelector('#chLoc'); if (loc) loc.onclick = sendLoc;
      box.querySelector('#chAuto').onchange = (e) => { CHAT.autoplay = e.target.checked; try { localStorage.setItem('mt_autoplay', CHAT.autoplay ? '1' : '0'); } catch {} };
      // рация: держать, чтобы говорить; отпустить — отправить; увести палец — отменить
      const ptt = box.querySelector('#ptt'), pttT = box.querySelector('#pttT');
      const down = (e) => { e.preventDefault(); ptt.classList.add('rec'); recStart((s) => { pttT.textContent = `${t('chatRec')} ${s.toFixed(0)}/${MAX_REC}${t('sec')}`; }); };
      const up = (e) => { e.preventDefault(); ptt.classList.remove('rec'); pttT.textContent = t('chatHold'); recStop(e.type === 'pointerleave' || e.type === 'pointercancel'); };
      ptt.addEventListener('pointerdown', down);
      ptt.addEventListener('pointerup', up);
      ptt.addEventListener('pointerleave', (e) => { if (recording()) up(e); });
      ptt.addEventListener('pointercancel', up);
      ptt.oncontextmenu = (e) => e.preventDefault();
    };
    CHAT.open = { redraw: () => { const inp = box.querySelector('#chText'); const v = inp ? inp.value : ''; const foc = document.activeElement === inp; if (recording()) return; draw(); const n = box.querySelector('#chText'); if (n) { n.value = v; if (foc) n.focus(); } } };
    draw();
  }, { onClose: () => { CHAT.open = null; recStop(true); } });
}

/** Полоса голосового чата вверху окна. */
function voiceBar(me) {
  const chName = CHAT.ch === 'team' ? `${t('chatTeam')}: ${t(me.role === 'hunter' ? 'huntersPl' : 'hidersPl')}` : t('chatAll');
  if (!VOICE.on) return `<button class="btn block voice-join" id="vJoin">🎧 ${t('voiceJoin')} · ${esc(chName)}</button>`;
  const peers = [...VOICE.peers.values()];
  const chip = (name, id, state) => `<span class="vchip ${VOICE.speaking.has(id) ? 'talk' : ''}"><i class="st ${state}"></i>${esc(name)}</span>`;
  return `<div class="voice-bar">
    <div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>🎧 ${t('voiceLive')} · ${esc(VOICE.ch === 'team' ? t('chatTeam') : t('chatAll'))}</b><span style="color:var(--muted);font-size:13px">${peers.length ? '' : t('voiceAlone')}</span></div>
    <div class="vchips">${chip(t('you'), 'me', VOICE.mic ? 'direct' : 'muted')}${peers.map((p) => chip(p.name || '?', p.id, p.state)).join('')}</div>
    <div class="row" style="flex-wrap:nowrap;margin-top:8px"><button class="btn ${VOICE.mic ? 'primary' : ''}" id="vMic" style="flex:1">${VOICE.mic ? '🎙 ' + t('voiceMicOn') : '🔇 ' + t('voiceMicOff')}</button><button class="btn danger" id="vLeave">${t('voiceLeave')}</button></div>
    <div class="vlegend"><i class="st direct"></i>${t('voiceDirect')} <i class="st relay"></i>${t('voiceRelay')} <i class="st connecting"></i>${t('voiceConnecting')}</div>
  </div>`;
}
