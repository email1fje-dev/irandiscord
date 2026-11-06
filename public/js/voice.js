'use strict';
// ---------- Voice & video: WebRTC full mesh, Socket.IO signaling (perfect negotiation) ----------
const VM = { muted: false, deafened: false, before: false }; // persistent mute/deafen preference
const newVoice = () => ({ channelId: null, serverId: null, out: null, mic: null, cam: null, screen: null, preview: null, peers: new Map(), an: new Map(), ac: null });
let V = newVoice();
const sig = (to, data) => S.socket && S.socket.emit('voice:signal', { to, data });
const hasDisplayMedia = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

const voiceJoin = guard(async cid => {
  if (V.channelId === cid) return;
  if (!navigator.mediaDevices || !window.RTCPeerConnection) throw new Error('مرورگر شما از تماس صوتی پشتیبانی نمی‌کند');
  if (V.channelId) await voiceLeave();
  let mic = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: prefs.mic ? { ideal: prefs.mic } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (_) { toast('دسترسی به میکروفون ممکن نشد؛ فقط شنونده خواهید بود', 'warn'); }
  const r = await ack('voice:join', { channelId: cid });
  if (!r.ok) { if (mic) mic.getTracks().forEach(t => t.stop()); throw new Error(r.error); }
  V = newVoice(); V.channelId = cid; V.serverId = (findChannel(cid) || {}).server_id; V.out = new MediaStream();
  if (mic) { V.mic = mic.getAudioTracks()[0]; V.out.addTrack(V.mic); watchLevel(S.socket.id, new MediaStream([V.mic])); }
  applyAudio(); emitVoiceState();
  r.peers.forEach(p => makePeer(p.socketId)); // the joiner opens the connections
  beep(SOUNDS.join); updateVoiceUi();
});
async function voiceLeave() {
  if (!V.channelId) return;
  if (S.socket && S.socket.connected) S.socket.emit('voice:leave');
  voiceCleanup(); beep(SOUNDS.leave); updateVoiceUi();
}
function voiceCleanup() {
  V.peers.forEach(closePeer);
  [V.mic, V.cam, V.screen].forEach(t => t && t.stop());
  if (V.ac) V.ac.close().catch(() => {});
  V = newVoice();
  const box = $('#voice-audio'); if (box) box.innerHTML = '';
}
function closePeer(p) { try { p.pc.close(); } catch (_) {} if (p.audioEl) { p.audioEl.srcObject = null; p.audioEl.remove(); } }

function makePeer(sid) {
  if (V.peers.has(sid)) return V.peers.get(sid);
  const pc = new RTCPeerConnection({ iceServers: S.cfg.iceServers });
  const peer = { sid, pc, polite: S.socket.id > sid, makingOffer: false, ignoreOffer: false, stream: null, senders: {}, audioEl: null };
  V.peers.set(sid, peer);
  V.out.getTracks().forEach(t => { peer.senders[t.id] = pc.addTrack(t, V.out); });
  if (!V.mic) pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onnegotiationneeded = async () => {
    try { peer.makingOffer = true; await pc.setLocalDescription(); sig(sid, { description: pc.localDescription }); }
    catch (e) { console.warn('negotiation', e); } finally { peer.makingOffer = false; }
  };
  pc.onicecandidate = e => { if (e.candidate) sig(sid, { candidate: e.candidate }); };
  pc.ontrack = e => {
    if (!peer.stream) peer.stream = e.streams[0] || new MediaStream();
    if (!e.streams[0]) peer.stream.addTrack(e.track);
    attachPeer(peer);
    if (e.track.kind === 'audio') watchLevel(sid, new MediaStream([e.track]));
  };
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce(); };
  return peer;
}
async function onVoiceSignal({ from, data }) {
  if (!V.channelId) return;
  const peer = makePeer(from), pc = peer.pc;
  try {
    if (data.description) {
      const d = data.description;
      const collision = d.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(d);
      if (d.type === 'offer') { await pc.setLocalDescription(); sig(from, { description: pc.localDescription }); }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) console.warn('ice', e); }
    }
  } catch (e) { console.warn('signal', e); }
}
function attachPeer(p) {
  if (!p.audioEl) { // audio plays from a persistent hidden element so it continues while browsing other channels
    const a = document.createElement('audio'); a.autoplay = true; $('#voice-audio').appendChild(a); p.audioEl = a;
    if (prefs.spk && a.setSinkId) a.setSinkId(prefs.spk).catch(() => {});
  }
  p.audioEl.srcObject = p.stream; p.audioEl.muted = VM.deafened; p.audioEl.play().catch(() => {});
  bindTiles();
}

// ----- participants / UI sync -----
function onVoiceUpdate({ channelId, participants }) {
  const old = S.voice[channelId] || []; S.voice[channelId] = participants;
  if (V.channelId === channelId) {
    const oldIds = new Set(old.map(p => p.socketId)), ids = new Set(participants.map(p => p.socketId));
    if (participants.some(p => !oldIds.has(p.socketId) && p.socketId !== S.socket.id)) beep(SOUNDS.join);
    if (old.some(p => !ids.has(p.socketId) && p.socketId !== S.socket.id)) beep(SOUNDS.leave);
    for (const [sid, p] of [...V.peers]) if (!ids.has(sid)) { closePeer(p); V.peers.delete(sid); V.an.delete(sid); }
  }
  renderSide(); if ($('#vgrid')) renderVoiceGrid();
}
function emitVoiceState() { if (S.socket && V.channelId) S.socket.emit('voice:state', { muted: VM.muted, deafened: VM.deafened, video: !!V.cam, screen: !!V.screen }); }
function applyAudio() {
  if (V.mic) V.mic.enabled = !VM.muted;
  V.peers.forEach(p => { if (p.audioEl) p.audioEl.muted = VM.deafened; });
}
function updateVoiceUi() { renderSide(); if ($('#vgrid')) { renderVoiceGrid(); renderVoiceControls(); } }

function voiceViewHtml(ch) {
  return `<header class="main-head"><button class="icon-btn only-mobile" data-act="panel" data-p="nav">☰</button><h2>🔊 ${esc(ch.name)}</h2><div class="grow"></div>
    <button class="icon-btn only-desktop" data-act="toggle-members">👥</button></header>
    <div class="voice-room"><div id="vgrid" class="vgrid"></div><div id="vctl" class="vctl"></div></div>`;
}
function renderVoiceGrid() {
  const grid = $('#vgrid'); if (!grid) return;
  const cid = S.cur.channelId, parts = S.voice[cid] || [];
  if (!parts.length) { grid.innerHTML = '<div class="muted center pad">کسی در این کانال صوتی نیست. برای شروع وصل شوید.</div>'; return; }
  grid.innerHTML = parts.map(p => {
    const u = userOf(p.userId) || { id: p.userId, display_name: 'کاربر' }, vid = p.video || p.screen;
    const sp = V.an.get(p.socketId); 
    return `<div class="vtile${vid ? ' has-video' : ''}${sp && sp.on ? ' speaking' : ''}" data-vu="${p.socketId}" data-sid="${p.socketId}">
      <video autoplay playsinline muted></video><div class="vav">${avatar(u, 'av-xl')}</div>
      <div class="vname">${p.muted || p.deafened ? '🔇 ' : ''}${p.deafened ? '🎧✕ ' : ''}${p.screen ? '🖥 ' : ''}${esc(u.display_name)}${vtick(u)}${p.socketId === (S.socket && S.socket.id) ? ' (شما)' : ''}</div></div>`;
  }).join('');
  bindTiles();
}
function bindTiles() {
  $$('#vgrid .vtile').forEach(t => {
    const sid = t.dataset.sid, v = $('video', t);
    const stream = sid === (S.socket && S.socket.id) ? V.preview : (V.peers.get(sid) || {}).stream;
    if (v.srcObject !== (stream || null)) v.srcObject = stream || null;
    if (stream) v.play().catch(() => {});
  });
}
function renderVoiceControls() {
  const el = $('#vctl'); if (!el) return;
  const cid = S.cur.channelId;
  if (V.channelId !== cid) { el.innerHTML = `<button class="btn primary big" data-act="v-join" data-id="${cid}">🔊 اتصال به کانال صوتی</button>`; return; }
  el.innerHTML = `<button class="vbtn${VM.muted ? ' off' : ''}" data-act="v-mute" title="میکروفون">${VM.muted ? '🔇' : '🎤'}</button>
    <button class="vbtn${VM.deafened ? ' off' : ''}" data-act="v-deaf" title="ناشنوا شدن">${VM.deafened ? '🔕' : '🎧'}</button>
    <button class="vbtn${V.cam ? ' on' : ''}" data-act="v-cam" title="دوربین">📷</button>
    ${hasDisplayMedia() ? `<button class="vbtn${V.screen ? ' on' : ''}" data-act="v-screen" title="اشتراک صفحه">🖥</button>` : ''}
    <button class="vbtn danger" data-act="v-leave" title="قطع تماس">📞</button>`;
}
function watchLevel(id, stream) { // speaking indicator
  try {
    V.ac = V.ac || new (window.AudioContext || window.webkitAudioContext)();
    const an = V.ac.createAnalyser(); an.fftSize = 512; V.ac.createMediaStreamSource(stream).connect(an);
    V.an.set(id, { an, buf: new Uint8Array(an.fftSize), on: false });
  } catch (_) {}
}
setInterval(() => {
  if (!V.channelId) return;
  for (const [id, o] of V.an) {
    o.an.getByteTimeDomainData(o.buf);
    let mx = 0; for (const v of o.buf) { const d = Math.abs(v - 128); if (d > mx) mx = d; }
    let on = mx > 10; if (S.socket && id === S.socket.id && VM.muted) on = false;
    if (on !== o.on) { o.on = on; $$(`[data-vu="${id}"]`).forEach(e => e.classList.toggle('speaking', on)); }
  }
}, 120);

// ----- controls -----
function setVideo(kind, t) {
  V[kind] = t; V.out.addTrack(t);
  V.peers.forEach(p => { p.senders[t.id] = p.pc.addTrack(t, V.out); });
  t.onended = () => stopVideo(kind);
  V.preview = new MediaStream([t]); emitVoiceState(); updateVoiceUi();
}
function stopVideo(kind) {
  const t = V[kind]; if (!t) return;
  t.onended = null; t.stop(); V.out.removeTrack(t);
  V.peers.forEach(p => { const s = p.senders[t.id]; if (s) { try { p.pc.removeTrack(s); } catch (_) {} delete p.senders[t.id]; } });
  V[kind] = null; const other = V.cam || V.screen; V.preview = other ? new MediaStream([other]) : null;
  emitVoiceState(); updateVoiceUi();
}
ACT['v-join'] = el => voiceJoin(+el.dataset.id);
ACT['v-leave'] = () => voiceLeave();
ACT['v-mute'] = () => {
  if (VM.deafened) { VM.deafened = false; VM.muted = false; } else VM.muted = !VM.muted;
  applyAudio(); emitVoiceState(); updateVoiceUi();
};
ACT['v-deaf'] = () => {
  VM.deafened = !VM.deafened;
  if (VM.deafened) { VM.before = VM.muted; VM.muted = true; } else VM.muted = VM.before;
  applyAudio(); emitVoiceState(); updateVoiceUi();
};
ACT['v-cam'] = async () => {
  if (!V.channelId) return;
  if (V.cam) return stopVideo('cam');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: prefs.cam ? { ideal: prefs.cam } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } });
    if (V.screen) stopVideo('screen');
    setVideo('cam', s.getVideoTracks()[0]);
  } catch (_) { toast('دسترسی به دوربین ممکن نشد', 'err'); }
};
ACT['v-screen'] = async () => {
  if (!V.channelId) return;
  if (V.screen) return stopVideo('screen');
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
    if (V.cam) stopVideo('cam');
    setVideo('screen', s.getVideoTracks()[0]);
  } catch (_) { toast('اشتراک صفحه انجام نشد', 'warn'); }
};
