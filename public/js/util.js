'use strict';
// ---------- small DOM + formatting helpers (no dependencies) ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const fa = n => String(n).replace(/\d/g, d => FA_DIGITS[d]);

// ---------- Jalali (Shamsi) calendar: self-contained Gregorian -> Jalali converter ----------
function g2j(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053); days %= 12053;
  jy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}
const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const jDate = d => { d = new Date(d); const [y, m, dd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate()); return `${fa(dd)} ${J_MONTHS[m - 1]} ${fa(y)}`; };
const jTime = d => { d = new Date(d); return fa(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')); };
const dayKey = d => { d = new Date(d); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
function relDay(d) {
  const k = dayKey(d), now = new Date(), y = new Date(now.getTime() - 864e5);
  return k === dayKey(now) ? 'امروز' : k === dayKey(y) ? 'دیروز' : jDate(d);
}
const jStamp = d => `${relDay(d)}، ${jTime(d)}`;
const fmtSize = b => b < 1024 ? fa(b) + ' بایت' : b < 1048576 ? fa((b / 1024).toFixed(1)) + ' کیلوبایت' : fa((b / 1048576).toFixed(1)) + ' مگابایت';

// ---------- Markdown (bold, italic, code, code block, spoiler, strike, links, mentions) ----------
// ctx: { name(id) -> display name | null, me: myId }
function md(text, ctx = {}) {
  let s = esc(text);
  const stash = []; const put = h => '\u0000' + (stash.push(h) - 1) + '\u0000';
  s = s.replace(/```(?:[\w-]*\n)?([\s\S]*?)```/g, (m, c) => put('<pre><code>' + c.replace(/\n$/, '') + '</code></pre>'));
  s = s.replace(/`([^`\n]+)`/g, (m, c) => put('<code>' + c + '</code>'));
  s = s.replace(/&lt;@(\d+)&gt;/g, (m, id) => {
    const n = ctx.name && ctx.name(+id);
    return put(`<span class="mention${+id === ctx.me ? ' me' : ''}" data-act="profile" data-uid="${id}">@${esc(n || 'کاربر')}</span>`);
  });
  s = s.replace(/@everyone/g, () => put('<span class="mention me">@everyone</span>'));
  s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler" data-act="spoiler">$1</span>');
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<i>$2</i>');
  s = s.replace(/~~([\s\S]+?)~~/g, '<s>$1</s>');
  s = s.replace(/https?:\/\/[^\s<\u0000]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[i]);
}

const EMOJIS = ('😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😅 😭 😡 🥳 😴 🤯 🙄 👍 👎 👏 🙏 💪 👀 🔥 ✨ 🎉 ❤️ 💔 💯 ✅ ❌ ⭐ 🌹 ☕ 🍉 🎵 🎮 💻 📌 🚀 🌙 ☀️ 🌈 🐱 🐶 🍕 ⚽ 🎁 😇 🤝 😢').split(' ');

// ---------- avatars / presence ----------
const hue = id => (Number(id) * 47) % 360;
function avatar(u, cls = '') {
  if (!u) return `<span class="av ${cls}"></span>`;
  if (u.avatar) return `<img class="av ${cls}" src="${esc(u.avatar)}" alt="" loading="lazy">`;
  const ch = Array.from(u.display_name || u.name || '?')[0] || '?';
  return `<span class="av ${cls}" style="background:hsl(${hue(u.id)} 45% 38%)">${esc(ch)}</span>`;
}
const vtick = o => o && o.verified ? '<span class="vt" title="تأیید‌شده"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1d9bf0"/><path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '';
const dot = p => `<i class="dot dot-${p || 'offline'}"></i>`;
const PRESENCE_FA = { online: 'آنلاین', idle: 'دور از دسترس', dnd: 'مزاحم نشوید', offline: 'آفلاین' };

// ---------- logo (inline SVG, original artwork) ----------
const LOGO = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#lg)"/><path d="M10 34c4-12 8-12 11 0s7 12 11 0 7-12 11 0 5 8 7 6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>`;

// ---------- toasts, modals, popovers ----------
function toast(msg, kind = '') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 4000);
}
function modal(title, html, opts = {}) {
  const el = document.createElement('div'); el.className = 'modal-back';
  el.innerHTML = `<div class="modal ${opts.cls || ''}" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="بستن">✕</button></header><div class="modal-body">${html}</div></div>`;
  el.addEventListener('mousedown', e => { el._down = e.target === el; });
  el.addEventListener('click', e => { if ((e.target === el && el._down) || e.target.closest('[data-close]')) el.close(); });
  el.close = () => { if (el._closing) return; el._closing = true; el.classList.add('closing'); opts.onClose && opts.onClose(); setTimeout(() => el.remove(), 160); };
  $('#modal-root').appendChild(el);
  return el;
}
const closeModals = () => $$('.modal-back').forEach(m => m.close());
function pop(anchor, html, cls = '') {
  closePop();
  const el = document.createElement('div'); el.className = 'pop ' + cls; el.innerHTML = html;
  $('#pop-root').appendChild(el);
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  let y = r.bottom + 6; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  function outside(e) { if (!el.contains(e.target)) closePop(); }
  el._outside = outside;
  return el;
}
function closePop() { $$('#pop-root .pop').forEach(p => { document.removeEventListener('mousedown', p._outside, true); p.remove(); }); }

// ---------- sounds (synthesized, no asset files) ----------
let _ac;
function beep(seq, vol = 0.05) {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    if (_ac.state === 'suspended') _ac.resume();
    let t = _ac.currentTime;
    for (const [f, d] of seq) {
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(_ac.destination);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.start(t); o.stop(t + d); t += d * 0.9;
    }
  } catch (_) {}
}
const SOUNDS = { join: [[520, .12], [780, .16]], leave: [[620, .12], [380, .18]], msg: [[880, .09], [660, .12]] };

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const throttle = (fn, ms) => { let last = 0; return (...a) => { const n = Date.now(); if (n - last >= ms) { last = n; fn(...a); } }; };
