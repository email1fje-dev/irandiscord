'use strict';
// Socket.IO: real-time messaging, typing, read state, presence and WebRTC voice signaling.
const { one, all, q } = require('./db');
const { P } = require('./config');
const bus = require('./bus');
const voice = require('./voice');
const msgs = require('./msgs');
const { verifyToken } = require('./routes/auth');
const { HttpError, bad, forbidden, notFound, int, channelCtx, roomsFor, isBlocked, markRead, pub } = require('./util');

function cleanAttachments(a) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, 10).map(x => {
    if (!x || typeof x.url !== 'string' || !/^\/uploads\/[a-f0-9]{24}(\.[a-z0-9]{1,10})?$/i.test(x.url)) throw bad('پیوست نامعتبر است');
    return { url: x.url, name: String(x.name || 'file').slice(0, 120), size: Number(x.size) || 0, mime: String(x.mime || '').slice(0, 100) };
  });
}

module.exports = function attach(io) {
  bus.io = io;

  // Tell everyone who can see this user (servers, friends, DM partners, self) about profile/presence changes
  async function broadcastUser(uid) {
    const u = await one('SELECT id,username,display_name,avatar,status_text,presence,verified FROM users WHERE id=$1', [uid]);
    if (!u) return;
    const rooms = new Set(['user:' + uid]);
    (await all('SELECT server_id FROM members WHERE user_id=$1', [uid])).forEach(r => rooms.add('server:' + r.server_id));
    (await all('SELECT CASE WHEN a_id=$1 THEN b_id ELSE a_id END AS id FROM friends WHERE a_id=$1 OR b_id=$1', [uid])).forEach(r => rooms.add('user:' + r.id));
    (await all('SELECT DISTINCT user_id FROM dm_members WHERE channel_id IN (SELECT channel_id FROM dm_members WHERE user_id=$1)', [uid])).forEach(r => rooms.add('user:' + r.user_id));
    io.to([...rooms]).emit('user:update', pub(u));
  }
  bus.broadcastUser = uid => broadcastUser(uid).catch(e => console.error('[presence]', e.message));

  io.use(async (socket, next) => {
    try {
      if (!bus.ready) return next(new Error('not-ready'));
      const u = await verifyToken(socket.handshake.auth && socket.handshake.auth.token);
      if (!u) return next(new Error('unauthorized'));
      socket.user = u; next();
    } catch (e) { next(new Error('unauthorized')); }
  });

  io.on('connection', socket => {
    const uid = socket.user.id;
    const bucket = { n: 0, t: Date.now() }; // crude flood protection for sending messages

    // Wrap handlers: acknowledgement {ok, ...} and friendly Persian errors
    const on = (ev, fn) => socket.on(ev, async (data, ack) => {
      if (typeof ack !== 'function') ack = null;
      try { const r = await fn(data && typeof data === 'object' ? data : {}); if (ack) ack({ ok: true, ...(r || {}) }); }
      catch (e) {
        if (!(e instanceof HttpError)) console.error('[socket]', ev, e);
        if (ack) ack({ ok: false, error: e instanceof HttpError ? e.message : 'خطای داخلی سرور' });
      }
    });

    // presence bookkeeping
    let set = bus.online.get(uid); if (!set) { set = new Set(); bus.online.set(uid, set); }
    set.add(socket.id); if (set.size === 1) bus.broadcastUser(uid);
    socket.join('user:' + uid);
    all('SELECT server_id FROM members WHERE user_id=$1', [uid])
      .then(rows => { rows.forEach(r => socket.join('server:' + r.server_id)); socket.emit('ready'); })
      .catch(e => console.error('[socket] join rooms', e.message));

    on('msg:send', async d => {
      const now = Date.now(); if (now - bucket.t > 5000) { bucket.t = now; bucket.n = 0; }
      if (++bucket.n > 12) throw new HttpError(429, 'آهسته‌تر پیام بفرستید');
      const { ch, info } = await channelCtx(int(d.channelId), uid);
      if (!['text', 'dm', 'group'].includes(ch.type)) throw bad('در این کانال نمی‌توان پیام فرستاد');
      let content = String(d.content || '').slice(0, 4000).replace(/\s+$/, '');
      const attachments = cleanAttachments(d.attachments);
      if (!content.trim() && !attachments.length) throw bad('پیام خالی است');
      if (info) {
        if (!(info.perms & P.SEND_MESSAGES)) throw forbidden('اجازه ارسال پیام در این سرور را ندارید');
        if (info.timeout) throw forbidden('شما در حالت تایم‌اوت هستید و نمی‌توانید پیام بفرستید');
        if (attachments.length && !(info.perms & P.ATTACH_FILES)) throw forbidden('اجازه ارسال فایل ندارید');
        if (!(info.perms & P.MENTION_EVERYONE)) content = content.replace(/@everyone/g, '@\u200ceveryone');
      } else if (ch.type === 'dm') {
        const other = await one('SELECT user_id FROM dm_members WHERE channel_id=$1 AND user_id<>$2', [ch.id, uid]);
        if (other && await isBlocked(uid, other.user_id)) throw forbidden('امکان ارسال پیام به این کاربر وجود ندارد');
      }
      let replyTo = null;
      if (d.replyTo) { const r = await one('SELECT id FROM messages WHERE id=$1 AND channel_id=$2', [int(d.replyTo), ch.id]); replyTo = r ? r.id : null; }
      const row = await one('INSERT INTO messages(channel_id,author_id,content,reply_to,attachments) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id',
        [ch.id, uid, content, replyTo, JSON.stringify(attachments)]);
      const message = await msgs.getMessage(row.id);
      io.to(await roomsFor(ch)).emit('msg:new', message);
      markRead(uid, ch.id, row.id).catch(() => {});
      return { message };
    });

    on('msg:edit', async d => {
      const m = await one('SELECT * FROM messages WHERE id=$1', [int(d.id)]);
      if (!m) throw notFound('پیام پیدا نشد');
      if (m.author_id !== uid) throw forbidden('فقط نویسنده پیام می‌تواند آن را ویرایش کند');
      const { ch, info } = await channelCtx(m.channel_id, uid);
      if (info && info.timeout) throw forbidden('شما در حالت تایم‌اوت هستید');
      let content = String(d.content || '').slice(0, 4000).replace(/\s+$/, '');
      if (!content.trim() && !(m.attachments || []).length) throw bad('پیام خالی است');
      if (info && !(info.perms & P.MENTION_EVERYONE)) content = content.replace(/@everyone/g, '@\u200ceveryone');
      const r = await one('UPDATE messages SET content=$1, edited_at=now() WHERE id=$2 RETURNING edited_at', [content, m.id]);
      io.to(await roomsFor(ch)).emit('msg:edit', { id: m.id, channel_id: ch.id, content, edited_at: r.edited_at });
    });

    on('msg:delete', async d => {
      const m = await one('SELECT * FROM messages WHERE id=$1', [int(d.id)]);
      if (!m) throw notFound('پیام پیدا نشد');
      const { ch, info } = await channelCtx(m.channel_id, uid);
      if (m.author_id !== uid && !(info && (info.perms & P.MANAGE_MESSAGES))) throw forbidden('اجازه حذف این پیام را ندارید');
      await q('DELETE FROM messages WHERE id=$1', [m.id]);
      io.to(await roomsFor(ch)).emit('msg:delete', { id: m.id, channel_id: ch.id });
    });

    on('msg:react', async d => {
      const emoji = String(d.emoji || '').slice(0, 16); if (!emoji) throw bad();
      const m = await one('SELECT * FROM messages WHERE id=$1', [int(d.id)]);
      if (!m) throw notFound('پیام پیدا نشد');
      const { ch, info } = await channelCtx(m.channel_id, uid);
      if (info && info.timeout) throw forbidden('شما در حالت تایم‌اوت هستید');
      const del = await one('DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3 RETURNING 1', [m.id, uid, emoji]);
      if (!del) {
        const n = (await one('SELECT count(DISTINCT emoji)::int AS n FROM reactions WHERE message_id=$1', [m.id])).n;
        const exists = await one('SELECT 1 FROM reactions WHERE message_id=$1 AND emoji=$2 LIMIT 1', [m.id, emoji]);
        if (n >= 20 && !exists) throw bad('تعداد واکنش‌ها به حداکثر رسیده است');
        await q('INSERT INTO reactions(message_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [m.id, uid, emoji]);
      }
      io.to(await roomsFor(ch)).emit('msg:reactions', { id: m.id, channel_id: ch.id, reactions: await msgs.reactionsOf(m.id) });
    });

    on('msg:pin', async d => {
      const m = await one('SELECT * FROM messages WHERE id=$1', [int(d.id)]);
      if (!m) throw notFound('پیام پیدا نشد');
      const { ch, info } = await channelCtx(m.channel_id, uid);
      if (info && !(info.perms & P.MANAGE_MESSAGES)) throw forbidden('اجازه پین کردن پیام را ندارید');
      const pinned = !!d.pinned;
      await q('UPDATE messages SET pinned=$1 WHERE id=$2', [pinned, m.id]);
      io.to(await roomsFor(ch)).emit('msg:pin', { id: m.id, channel_id: ch.id, pinned });
    });

    on('typing', async d => {
      const { ch } = await channelCtx(int(d.channelId), uid);
      const rooms = await roomsFor(ch);
      socket.to(rooms).emit('typing', { channelId: ch.id, user: { id: uid, display_name: socket.user.display_name } });
    });

    on('read', async d => {
      const cid = int(d.channelId), last = int(d.lastId);
      await channelCtx(cid, uid);
      await markRead(uid, cid, last);
    });

    // ---- voice (WebRTC mesh signaling) ----
    on('voice:join', async d => {
      const { ch, info } = await channelCtx(int(d.channelId), uid);
      if (ch.type !== 'voice') throw bad('این کانال صوتی نیست');
      if (!(info.perms & P.CONNECT_VOICE)) throw forbidden('اجازه اتصال به کانال صوتی را ندارید');
      if (info.timeout) throw forbidden('شما در حالت تایم‌اوت هستید');
      return { peers: voice.join(socket, ch, uid) };
    });
    on('voice:leave', async () => { voice.leave(socket); });
    on('voice:state', async d => { voice.setState(socket, d); });
    on('voice:signal', async d => {
      const v = socket.data.voice; if (!v) return;
      const target = io.sockets.sockets.get(String(d.to));
      if (!target || !target.data.voice || target.data.voice.channelId !== v.channelId) return;
      target.emit('voice:signal', { from: socket.id, userId: uid, data: d.data });
    });

    socket.on('disconnect', () => {
      voice.leave(socket);
      const s = bus.online.get(uid);
      if (s) { s.delete(socket.id); if (!s.size) { bus.online.delete(uid); bus.broadcastUser(uid); } }
    });
  });
};
