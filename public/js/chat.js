'use strict';
// ---------- messages: load, render, send, edit, react, pin, search ----------
const chatOf = cid => S.chat[cid] || (S.chat[cid] = { list: [], more: true, loading: false, loaded: false, reply: null, attachments: [], uploading: 0, draft: '', mentions: {} });
const findMsg = id => { const c = chatOf(S.cur.channelId); return c.list.find(m => m.id === id); };

async function loadMessages(cid, older) {
  const c = chatOf(cid); if (c.loading) return; c.loading = true;
  try {
    const r = await get(`/api/channels/${cid}/messages?limit=50` + (older && c.list.length ? `&before=${c.list[0].id}` : ''));
    c.list = older ? r.messages.concat(c.list) : r.messages;
    if (!older) c.loaded = true;
    c.more = r.messages.length >= 50;
  } finally { c.loading = false; }
}

// ----- rendering -----
const hasMention = m => m.content.includes(`<@${S.me.id}>`) || m.content.includes('@everyone');
function attHtml(a) {
  const u = esc(a.url), n = esc(a.name);
  if (/^image\//.test(a.mime)) return `<img class="att-img" src="${u}" alt="${n}" data-act="lightbox" data-src="${u}" loading="lazy">`;
  if (/^video\//.test(a.mime)) return `<video class="att-vid" controls preload="metadata" src="${u}"></video>`;
  if (/^audio\//.test(a.mime)) return `<audio controls preload="none" src="${u}"></audio>`;
  return `<a class="att-file" href="${u}" download="${n}" target="_blank" rel="noopener"><span>${ico('file')}</span><b>${n}</b><small>${fmtSize(a.size)}</small></a>`;
}
function reactionsHtml(m) {
  return (m.reactions || []).slice().sort((a, b) => a.emoji.localeCompare(b.emoji)).map(r =>
    `<button class="react${r.users.includes(S.me.id) ? ' mine' : ''}" data-act="react" data-id="${m.id}" data-emoji="${esc(r.emoji)}">${esc(r.emoji)} <span>${fa(r.users.length)}</span></button>`).join('');
}
const sepHtml = (m, prev) => (!prev || dayKey(prev.created_at) !== dayKey(m.created_at)) ? `<div class="day-sep"><span>${esc(relDay(m.created_at))}</span></div>` : '';
function msgEl(m, prev) {
  const a = S.users[m.author_id] || m.author;
  const cont = prev && prev.author_id === m.author_id && dayKey(prev.created_at) === dayKey(m.created_at) &&
    (new Date(m.created_at) - new Date(prev.created_at)) < 300000 && !m.reply_to;
  const col = S.cur.serverId ? roleColorOf(S.cur.serverId, m.author_id) : '';
  const reply = m.reply ? `<div class="reply" data-act="jump" data-id="${m.reply.id}">↩ <b>${esc(m.reply.author_name)}</b> ${esc(m.reply.content || 'فایل')}</div>` : '';
  return `<article class="msg${cont ? ' cont' : ''}${hasMention(m) ? ' mentioned' : ''}${m.pinned ? ' pinned' : ''}" data-mid="${m.id}" data-uid="${m.author_id}">
    <div class="msg-av" data-act="profile" data-uid="${m.author_id}">${cont ? '' : avatar(a, 'av-m')}</div>
    <div class="msg-main">${reply}
      ${cont ? '' : `<div class="msg-head"><b class="msg-name" data-act="profile" data-uid="${m.author_id}" style="${col ? 'color:' + esc(col) : ''}">${esc(a.display_name)}</b>${vtick(a)}<time title="${esc(jStamp(m.created_at))}">${jTime(m.created_at)}</time>${m.pinned ? `<span class="pin-ic" title="پین‌شده">${ico('pin')}</span>` : ''}</div>`}
      <div class="msg-body">${m.content ? md(m.content, mdCtx()) : ''}${m.edited_at ? '<small class="edited"> (ویرایش شده)</small>' : ''}</div>
      ${(m.attachments || []).map(attHtml).join('')}
      <div class="reactions">${reactionsHtml(m)}</div>
    </div>
    <div class="msg-tools"><button class="icon-btn" data-act="react-pick" data-id="${m.id}" title="واکنش">${ico('message')}</button><button class="icon-btn" data-act="msgmenu" data-id="${m.id}" title="بیشتر">⋯</button></div>
  </article>`;
}
function renderMsgList(mode) {
  const box = $('#msgs'); if (!box) return;
  const c = chatOf(S.cur.channelId), prevH = box.scrollHeight, prevTop = box.scrollTop;
  box.innerHTML = (c.more ? '<div class="load-more">در حال بارگذاری پیام‌های قدیمی…</div>' : '<div class="chan-start">ابتدای گفتگو</div>') +
    c.list.map((m, i) => sepHtml(m, c.list[i - 1]) + msgEl(m, c.list[i - 1])).join('');
  if (mode === 'bottom') box.scrollTop = box.scrollHeight;
  else if (mode === 'prepend') box.scrollTop = box.scrollHeight - prevH + prevTop;
  else box.scrollTop = prevTop;
}
function updateMsgEl(id) {
  const c = chatOf(S.cur.channelId), i = c.list.findIndex(m => m.id === id), el = $(`#msgs [data-mid="${id}"]`);
  if (i >= 0 && el) el.outerHTML = msgEl(c.list[i], c.list[i - 1]);
}
function refreshAuthors(uid) { // profile changed: re-render messages of that author
  const c = S.chat[S.cur.channelId]; if (!c) return;
  c.list.forEach(m => { if (m.author_id === uid) updateMsgEl(m.id); });
}

// ----- realtime handlers -----
function onMsgNew(m) {
  const c = chatOf(m.channel_id), mine = m.author_id === S.me.id;
  cacheUser({ id: m.author.id, username: m.author.username, display_name: m.author.display_name, avatar: m.author.avatar });
  if (c.loaded && !c.list.some(x => x.id === m.id)) c.list.push(m);
  if (S.typing[m.channel_id]) delete S.typing[m.channel_id][m.author_id];
  const viewing = S.cur.channelId === m.channel_id && !document.hidden;
  if (S.cur.channelId === m.channel_id && c.loaded) {
    const box = $('#msgs');
    if (box && !$(`#msgs [data-mid="${m.id}"]`)) {
      const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140, prev = c.list[c.list.length - 2];
      box.insertAdjacentHTML('beforeend', sepHtml(m, prev) + msgEl(m, prev));
      if (box.lastElementChild) box.lastElementChild.classList.add('new');
      if (near || mine) box.scrollTop = box.scrollHeight;
    }
    renderTyping();
  }
  if (!m.server_id) { // DM: make sure it is listed and moved to the top
    const d = S.dms.find(x => x.id === m.channel_id);
    if (d) { d.last_id = m.id; S.dms.sort((a, b) => (b.last_id || 0) - (a.last_id || 0)); }
    else reloadSocial().then(() => renderAll({ keepMain: true })).catch(() => {});
  }
  if (!mine) {
    if (viewing) markRead(m.channel_id, m.id);
    else {
      const u = S.unread[m.channel_id] || (S.unread[m.channel_id] = { count: 0, mentions: 0, server_id: m.server_id });
      u.count++; if (hasMention(m)) u.mentions++;
    }
    if (!viewing || hasMention(m)) notifyMessage(m);
  }
  renderRail(); renderSide();
}
function notifyMessage(m) {
  if (!S.me || S.me.presence === 'dnd') return;
  if (prefs.sound) beep(SOUNDS.msg);
  if (prefs.desktop && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(m.author.display_name, { body: (m.content || 'فایل').replace(/<@\d+>/g, '@').slice(0, 120), icon: m.author.avatar || undefined }); } catch (_) {}
  }
}
function markRead(cid, lastId) {
  if (S.unread[cid]) { delete S.unread[cid]; renderRail(); renderSide(); }
  if (S.socket && lastId) S.socket.emit('read', { channelId: cid, lastId });
}
function onMsgEdit(d) {
  const c = S.chat[d.channel_id]; const m = c && c.list.find(x => x.id === d.id); if (!m) return;
  m.content = d.content; m.edited_at = d.edited_at; if (S.cur.channelId === d.channel_id) updateMsgEl(d.id);
}
function onMsgDelete(d) {
  const c = S.chat[d.channel_id]; if (!c) return;
  c.list = c.list.filter(x => x.id !== d.id);
  if (S.cur.channelId === d.channel_id) renderMsgList('keep');
}
function onMsgReactions(d) {
  const c = S.chat[d.channel_id]; const m = c && c.list.find(x => x.id === d.id); if (!m) return;
  m.reactions = d.reactions; if (S.cur.channelId === d.channel_id) updateMsgEl(d.id);
}
function onMsgPin(d) {
  const c = S.chat[d.channel_id]; const m = c && c.list.find(x => x.id === d.id); if (!m) return;
  m.pinned = d.pinned; if (S.cur.channelId === d.channel_id) updateMsgEl(d.id);
}
function onTyping(d) {
  const t = S.typing[d.channelId] || (S.typing[d.channelId] = {});
  t[d.user.id] = { name: d.user.display_name, t: Date.now() + 5000 };
  if (S.cur.channelId === d.channelId) { renderTyping(); setTimeout(renderTyping, 5200); }
}
function renderTyping() {
  const el = $('#typing'); if (!el) return;
  const t = S.typing[S.cur.channelId] || {}, now = Date.now();
  const names = Object.entries(t).filter(([id, x]) => x.t > now && +id !== S.me.id).map(([, x]) => x.name);
  el.textContent = !names.length ? '' : names.length === 1 ? `${names[0]} در حال نوشتن است…` : names.length === 2 ? `${names[0]} و ${names[1]} در حال نوشتن هستند…` : 'چند نفر در حال نوشتن هستند…';
}

// ----- chat view (header + list + composer) -----
function chatViewHtml(ch, title, isDm) {
  const c = chatOf(ch.id);
  let composer;
  const sv = curServer();
  if (sv && !(sv.perms & S.cfg.perms.SEND_MESSAGES)) composer = '<div class="composer-off">شما اجازه ارسال پیام در این سرور را ندارید.</div>';
  else composer = `<div id="typing" class="typing"></div>
    <div id="reply-bar" class="reply-bar" hidden></div><div id="att-bar" class="att-bar"></div>
    <div class="composer"><div id="mention-pop" class="mention-pop" hidden></div>
      <button class="icon-btn" data-act="attach" title="افزودن فایل">${ico('paperclip')}</button><input type="file" id="file-in" multiple hidden>
      <textarea id="msg-in" rows="1" maxlength="4000" placeholder="پیام خود را بنویسید…"></textarea>
      
      <button class="send" data-act="send" title="ارسال">➤</button></div>`;
  return `<header class="main-head"><button class="icon-btn only-mobile" data-act="panel" data-p="nav">${ico('menu')}</button>
    <h2>${isDm ? '' : '<span class="hash">#</span>'}${esc(title)}</h2><div class="grow"></div>
    <div class="search-box" hidden><input id="search-in" type="search" placeholder="جستجو در پیام‌ها…"></div>
    <button class="icon-btn" data-act="search-toggle" title="جستجو">${ico('search')}</button>
    <button class="icon-btn" data-act="pins" title="پیام‌های پین‌شده">${ico('pin')}</button>
    <button class="icon-btn only-desktop" data-act="toggle-members" title="اعضا">${ico('users')}</button></header>
    <div id="msgs" class="msgs"></div>${composer}`;
}
function mountChat(cid) {
  const c = chatOf(cid), box = $('#msgs'); if (!box) return;
  const ta = $('#msg-in');
  if (ta) { ta.value = c.draft || ''; autosize(ta); renderReplyBar(); renderAtt(); }
  renderMsgList('bottom');
  box.addEventListener('scroll', () => {
    if (box.scrollTop < 60 && c.more && !c.loading && c.loaded) loadMessages(cid, true).then(() => renderMsgList('prepend')).catch(() => {});
  });
  if (!c.loaded) loadMessages(cid).then(() => { if (S.cur.channelId === cid) { renderMsgList('bottom'); const last = c.list[c.list.length - 1]; if (last) markRead(cid, last.id); } }).catch(e => toast(e.message, 'err'));
  else { const last = c.list[c.list.length - 1]; if (last) markRead(cid, last.id); }
  renderTyping();
  if (ta) {
    const typing = throttle(() => S.socket && S.socket.emit('typing', { channelId: cid }), 3000);
    ta.addEventListener('input', () => { autosize(ta); c.draft = ta.value; if (ta.value) typing(); mentionSuggest(ta); });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); sendMessage(); }
      if (e.key === 'Tab' && !$('#mention-pop').hidden) { e.preventDefault(); const f = $('#mention-pop button'); f && f.click(); }
    });
    ta.addEventListener('paste', e => { const f = [...(e.clipboardData ? e.clipboardData.files : [])]; if (f.length) { e.preventDefault(); attachFiles(f); } });
    $('#file-in').addEventListener('change', e => { attachFiles([...e.target.files]); e.target.value = ''; });
  }
  const si = $('#search-in'); if (si) si.addEventListener('keydown', e => { if (e.key === 'Enter') searchMessages(si.value.trim()); });
}
const autosize = ta => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; };

// ----- composer helpers -----
function renderReplyBar() {
  const c = chatOf(S.cur.channelId), el = $('#reply-bar'); if (!el) return;
  el.hidden = !c.reply;
  if (c.reply) el.innerHTML = `<span>پاسخ به <b>${esc(c.reply.name)}</b>: ${esc(c.reply.content)}</span><button class="icon-btn" data-act="reply-cancel">✕</button>`;
}
function renderAtt() {
  const c = chatOf(S.cur.channelId), el = $('#att-bar'); if (!el) return;
  el.innerHTML = c.attachments.map((a, i) => `<span class="chip">${/^image\//.test(a.mime) ? `<img src="${esc(a.url)}" alt="">` : ico('file')}<b>${esc(a.name)}</b><button data-act="att-del" data-i="${i}">✕</button></span>`).join('') +
    (c.uploading ? `<span class="chip">⏳ در حال بارگذاری (${fa(c.uploading)})</span>` : '');
}
async function attachFiles(files) {
  const c = chatOf(S.cur.channelId), cid = S.cur.channelId;
  if (!can(S.cfg.perms.ATTACH_FILES) && S.cur.mode === 'server') return toast('اجازه ارسال فایل ندارید', 'err');
  for (const f of files) {
    if (c.attachments.length + c.uploading >= 10) { toast('حداکثر ۱۰ فایل در هر پیام', 'warn'); break; }
    if (f.size > 25 * 1024 * 1024) { toast(`«${f.name}» بزرگ‌تر از ۲۵ مگابایت است`, 'err'); continue; }
    c.uploading++; renderAtt();
    try { c.attachments.push(await upload(f)); } catch (e) { toast(e.message, 'err'); }
    c.uploading--; if (S.cur.channelId === cid) renderAtt();
  }
}
async function sendMessage() {
  const cid = S.cur.channelId, c = chatOf(cid), ta = $('#msg-in'); if (!ta) return;
  let content = ta.value.trim();
  if (!content && !c.attachments.length) return;
  if (c.uploading) return toast('منتظر پایان بارگذاری فایل‌ها بمانید', 'warn');
  // @Name typed via autocomplete -> <@id>
  Object.keys(c.mentions).sort((a, b) => b.length - a.length).forEach(k => { content = content.split(k).join(`<@${c.mentions[k]}>`); });
  const r = await ack('msg:send', { channelId: cid, content, replyTo: c.reply && c.reply.id, attachments: c.attachments });
  if (!r.ok) return toast(r.error, 'err');
  ta.value = ''; c.draft = ''; c.attachments = []; c.reply = null; c.mentions = {};
  autosize(ta); renderReplyBar(); renderAtt(); ta.focus();
}
function mentionSuggest(ta) {
  const pop = $('#mention-pop'); if (!pop) return;
  const m = /(?:^|\s)@([^\s@<>]*)$/.exec(ta.value.slice(0, ta.selectionStart));
  if (!m) { pop.hidden = true; return; }
  const q = m[1].toLowerCase();
  const sv = curServer(), dm = S.dms.find(d => d.id === S.cur.channelId);
  const pool = sv ? sv.members : dm ? dm.members : [];
  let items = pool.filter(u => u.id !== S.me.id && (u.display_name.toLowerCase().includes(q) || u.username.includes(q))).slice(0, 6)
    .map(u => `<button data-act="mention-pick" data-id="${u.id}">${avatar(u, 'av-s')}<span>${esc(u.display_name)}</span><small>@${esc(u.username)}</small></button>`);
  if (sv && can(S.cfg.perms.MENTION_EVERYONE) && 'everyone'.startsWith(q)) items.unshift('<button data-act="mention-pick" data-id="everyone"><span>@everyone</span><small>همه اعضا</small></button>');
  pop.innerHTML = items.join(''); pop.hidden = !items.length;
}
ACT['mention-pick'] = el => {
  const ta = $('#msg-in'), c = chatOf(S.cur.channelId), id = el.dataset.id;
  const before = ta.value.slice(0, ta.selectionStart), after = ta.value.slice(ta.selectionStart);
  const label = id === 'everyone' ? '@everyone' : '@' + nameOf(+id);
  if (id !== 'everyone') c.mentions[label] = +id;
  ta.value = before.replace(/@[^\s@<>]*$/, label + ' ') + after; c.draft = ta.value;
  $('#mention-pop').hidden = true; ta.focus();
};

// ----- actions -----
ACT.send = () => sendMessage();
ACT.attach = () => $('#file-in') && $('#file-in').click();
ACT['att-del'] = el => { chatOf(S.cur.channelId).attachments.splice(+el.dataset.i, 1); renderAtt(); };
ACT['reply-cancel'] = () => { chatOf(S.cur.channelId).reply = null; renderReplyBar(); };
ACT['emoji-compose'] = () => {};
ACT['emoji-ins'] = () => {};
ACT['react-pick'] = () => {};
ACT.react = guard(async el => { const r = await ack('msg:react', { id: +el.dataset.id, emoji: el.dataset.emoji }); if (!r.ok) toast(r.error, 'err'); });
ACT.msgmenu = el => {
  const m = findMsg(+el.dataset.id); if (!m) return;
  const mine = m.author_id === S.me.id, mod = S.cur.mode === 'server' ? can(S.cfg.perms.MANAGE_MESSAGES) : true;
  const b = (a, t, cls = '') => `<button class="${cls}" data-act="${a}" data-id="${m.id}">${t}</button>`;
  pop(el, b('reply', '↩ پاسخ') + (m.content ? b('copy', '⧉ کپی متن') : '') + (mine ? b('edit', '✎ ویرایش') : '') +
    (mod ? b('pin', m.pinned ? ico('pin') + ' برداشتن پین' : ico('pin') + ' پین کردن') : '') + (mine || (S.cur.mode === 'server' && mod) ? b('delmsg', ico('trash') + ' حذف', 'danger') : ''), 'menu');
};
ACT.reply = el => { const m = findMsg(+el.dataset.id); if (!m) return; chatOf(S.cur.channelId).reply = { id: m.id, name: nameOf(m.author_id) || m.author.display_name, content: (m.content || 'فایل').replace(/<@\d+>/g, '@').slice(0, 80) }; renderReplyBar(); const ta = $('#msg-in'); ta && ta.focus(); };
ACT.copy = el => { const m = findMsg(+el.dataset.id); navigator.clipboard && navigator.clipboard.writeText(m.content).then(() => toast('کپی شد')); };
ACT.pin = guard(async el => { const m = findMsg(+el.dataset.id); const r = await ack('msg:pin', { id: m.id, pinned: !m.pinned }); if (!r.ok) toast(r.error, 'err'); });
ACT.delmsg = guard(async el => { if (!confirm('این پیام حذف شود؟')) return; const r = await ack('msg:delete', { id: +el.dataset.id }); if (!r.ok) toast(r.error, 'err'); });
ACT.edit = el => {
  const id = +el.dataset.id, m = findMsg(id), art = $(`#msgs [data-mid="${id}"] .msg-body`); if (!m || !art) return;
  art.innerHTML = `<textarea class="edit-in" rows="2">${esc(m.content)}</textarea><div class="edit-hint">Enter برای ذخیره، Esc برای انصراف</div>`;
  const ta = $('textarea', art); ta.focus(); autosize(ta);
  ta.addEventListener('keydown', async e => {
    if (e.key === 'Escape') updateMsgEl(id);
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const r = await ack('msg:edit', { id, content: ta.value }); if (!r.ok) toast(r.error, 'err'); else if (!$(`#msgs [data-mid="${id}"] textarea`)) return; }
  });
};
ACT.jump = el => { const t = $(`#msgs [data-mid="${el.dataset.id}"]`); if (!t) return toast('پیام اصلی در بخش بارگذاری‌شده نیست', 'warn'); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600); };
ACT.spoiler = el => el.classList.toggle('open');
ACT.lightbox = el => modal('', `<img class="lightbox" src="${esc(el.dataset.src)}" alt="">`, { cls: 'wide' });
ACT['search-toggle'] = () => { const b = $('.search-box'); b.hidden = !b.hidden; if (!b.hidden) $('#search-in').focus(); };

function resultsHtml(list) {
  return list.length ? `<div class="results">${list.map(m => `<div class="result"><div class="msg-head">${avatar(S.users[m.author_id] || m.author, 'av-s')}<b>${esc((S.users[m.author_id] || m.author).display_name)}</b><time>${esc(jStamp(m.created_at))}</time></div><div class="msg-body">${md(m.content, mdCtx())}</div>${(m.attachments || []).map(attHtml).join('')}</div>`).join('')}</div>` : '<p class="muted center">موردی پیدا نشد.</p>';
}
const searchMessages = guard(async q => {
  if (!q) return; const r = await get(`/api/channels/${S.cur.channelId}/messages?limit=50&q=${encodeURIComponent(q)}`);
  modal(`نتایج جستجو برای «${q}»`, resultsHtml(r.messages.reverse()), { cls: 'wide' });
});
ACT.pins = guard(async () => { const r = await get(`/api/channels/${S.cur.channelId}/pins`); modal('پیام‌های پین‌شده', resultsHtml(r.messages.reverse()), { cls: 'wide' }); });
