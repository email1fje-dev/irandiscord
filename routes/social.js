'use strict';
// Home data (bootstrap), friends, blocks and direct/group messages.
const express = require('express');
const { one, all, q, tx } = require('../db');
const bus = require('../bus');
const { wrap, bad, forbidden, notFound, int, USER_COLS, pub, isBlocked } = require('../util');

const router = express.Router();
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

async function socialOf(uid) {
  const rows = sql => all(sql, [uid]).then(r => r.map(pub));
  return {
    friends: await rows(`SELECT ${USER_COLS} FROM friends f JOIN users u ON u.id = CASE WHEN f.a_id=$1 THEN f.b_id ELSE f.a_id END WHERE f.a_id=$1 OR f.b_id=$1 ORDER BY u.display_name`),
    incoming: await rows(`SELECT ${USER_COLS} FROM friend_requests r JOIN users u ON u.id=r.from_id WHERE r.to_id=$1`),
    outgoing: await rows(`SELECT ${USER_COLS} FROM friend_requests r JOIN users u ON u.id=r.to_id WHERE r.from_id=$1`),
    blocked: await rows(`SELECT ${USER_COLS} FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1`),
  };
}
async function dmsOf(uid, onlyId) {
  const chans = await all(
    `SELECT c.id, c.type, c.name, c.owner_id, (SELECT max(id) FROM messages WHERE channel_id=c.id) AS last_id
     FROM channels c JOIN dm_members d ON d.channel_id=c.id
     WHERE d.user_id=$1 AND c.type IN ('dm','group') AND ($2::int IS NULL OR c.id=$2)
     ORDER BY last_id DESC NULLS LAST, c.id DESC`, [uid, onlyId || null]);
  if (!chans.length) return [];
  const mem = await all(`SELECT d.channel_id, ${USER_COLS} FROM dm_members d JOIN users u ON u.id=d.user_id WHERE d.channel_id = ANY($1::int[])`, [chans.map(c => c.id)]);
  return chans.map(c => ({ ...c, members: mem.filter(m => m.channel_id === c.id).map(pub) }));
}
const refreshDm = ids => ids.forEach(i => bus.toUser(i, 'dm:refresh', {}));
const refreshSocial = (...ids) => ids.forEach(i => bus.toUser(i, 'social:refresh', {}));

router.get('/bootstrap', wrap(async (req, res) => {
  const uid = req.user.id;
  const servers = await all('SELECT s.id,s.name,s.icon,s.owner_id,s.verified FROM servers s JOIN members m ON m.server_id=s.id WHERE m.user_id=$1 ORDER BY m.joined_at', [uid]);
  const unreadRows = await all(
    `SELECT m.channel_id, c.server_id, count(*)::int AS count,
       count(*) FILTER (WHERE m.content LIKE $2 OR m.content LIKE '%@everyone%')::int AS mentions
     FROM messages m JOIN channels c ON c.id=m.channel_id
     LEFT JOIN reads r ON r.channel_id=m.channel_id AND r.user_id=$1
     LEFT JOIN members mb ON mb.server_id=c.server_id AND mb.user_id=$1
     WHERE m.author_id<>$1 AND m.id > COALESCE(r.last_id,0)
       AND ((c.server_id IS NOT NULL AND mb.user_id IS NOT NULL AND m.created_at > mb.joined_at)
         OR (c.server_id IS NULL AND EXISTS(SELECT 1 FROM dm_members d WHERE d.channel_id=c.id AND d.user_id=$1)))
     GROUP BY m.channel_id, c.server_id`, [uid, `%<@${uid}>%`]);
  const unread = {}; unreadRows.forEach(r => { unread[r.channel_id] = { count: r.count, mentions: r.mentions, server_id: r.server_id }; });
  res.json({ servers, dms: await dmsOf(uid), social: await socialOf(uid), unread });
}));
router.get('/social', wrap(async (req, res) => res.json({ social: await socialOf(req.user.id), dms: await dmsOf(req.user.id) })));

// ---- friends ----
router.post('/friends/request', wrap(async (req, res) => {
  const name = String((req.body || {}).username || '').trim().toLowerCase().replace(/^@/, '');
  const t = await one('SELECT id FROM users WHERE username=$1 AND NOT banned', [name]);
  const uid = req.user.id;
  if (!t) throw notFound('کاربری با این نام کاربری پیدا نشد');
  if (t.id === uid) throw bad('نمی‌توانید به خودتان درخواست بدهید');
  if (await isBlocked(uid, t.id)) throw forbidden('امکان ارسال درخواست به این کاربر وجود ندارد');
  const [a, b] = pair(uid, t.id);
  if (await one('SELECT 1 FROM friends WHERE a_id=$1 AND b_id=$2', [a, b])) throw bad('شما از قبل دوست هستید');
  if (await one('SELECT 1 FROM friend_requests WHERE from_id=$1 AND to_id=$2', [t.id, uid])) { // they already asked: accept
    await q('DELETE FROM friend_requests WHERE from_id=$1 AND to_id=$2', [t.id, uid]);
    await q('INSERT INTO friends(a_id,b_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [a, b]);
  } else await q('INSERT INTO friend_requests(from_id,to_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [uid, t.id]);
  refreshSocial(uid, t.id); res.json({ ok: true });
}));
router.post('/friends/:id/accept', wrap(async (req, res) => {
  const uid = req.user.id, o = int(req.params.id);
  const d = await one('DELETE FROM friend_requests WHERE from_id=$1 AND to_id=$2 RETURNING 1', [o, uid]);
  if (!d) throw notFound('درخواستی وجود ندارد');
  const [a, b] = pair(uid, o);
  await q('INSERT INTO friends(a_id,b_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [a, b]);
  refreshSocial(uid, o); res.json({ ok: true });
}));
router.post('/friends/:id/decline', wrap(async (req, res) => { // decline incoming OR cancel outgoing
  const uid = req.user.id, o = int(req.params.id);
  await q('DELETE FROM friend_requests WHERE (from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)', [uid, o]);
  refreshSocial(uid, o); res.json({ ok: true });
}));
router.delete('/friends/:id', wrap(async (req, res) => {
  const uid = req.user.id, o = int(req.params.id); const [a, b] = pair(uid, o);
  await q('DELETE FROM friends WHERE a_id=$1 AND b_id=$2', [a, b]);
  refreshSocial(uid, o); res.json({ ok: true });
}));
router.post('/blocks/:id', wrap(async (req, res) => {
  const uid = req.user.id, o = int(req.params.id); if (o === uid) throw bad();
  if (!(await one('SELECT 1 FROM users WHERE id=$1', [o]))) throw notFound();
  const [a, b] = pair(uid, o);
  await q('DELETE FROM friends WHERE a_id=$1 AND b_id=$2', [a, b]);
  await q('DELETE FROM friend_requests WHERE (from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)', [uid, o]);
  await q('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [uid, o]);
  refreshSocial(uid, o); res.json({ ok: true });
}));
router.delete('/blocks/:id', wrap(async (req, res) => {
  await q('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [req.user.id, int(req.params.id)]);
  refreshSocial(req.user.id); res.json({ ok: true });
}));

// ---- direct & group messages ----
router.post('/dms', wrap(async (req, res) => {
  const uid = req.user.id, b = req.body || {};
  const ids = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map(int))].filter(i => i !== uid).slice(0, 9);
  if (!ids.length) throw bad('حداقل یک کاربر را انتخاب کنید');
  const found = await all('SELECT id FROM users WHERE id = ANY($1::int[]) AND NOT banned', [ids]);
  if (found.length !== ids.length) throw notFound('کاربر پیدا نشد');
  let id;
  if (ids.length === 1) {
    if (await isBlocked(uid, ids[0])) throw forbidden('امکان ارسال پیام به این کاربر وجود ندارد');
    const ex = await one(`SELECT c.id FROM channels c WHERE c.type='dm'
      AND (SELECT count(*) FROM dm_members d WHERE d.channel_id=c.id AND d.user_id IN ($1,$2))=2 LIMIT 1`, [uid, ids[0]]);
    id = ex && ex.id;
  }
  if (!id) {
    const group = ids.length > 1;
    id = await tx(async c => {
      const ch = (await c.query('INSERT INTO channels(type,name,owner_id) VALUES($1,$2,$3) RETURNING id',
        [group ? 'group' : 'dm', group ? String(b.name || '').trim().slice(0, 50) : '', uid])).rows[0].id;
      for (const u of [uid, ...ids]) await c.query('INSERT INTO dm_members(channel_id,user_id) VALUES($1,$2)', [ch, u]);
      return ch;
    });
    refreshDm([uid, ...ids]);
  }
  res.json({ dm: (await dmsOf(uid, id))[0] });
}));
async function groupCtx(req) {
  const id = int(req.params.id);
  const ch = await one("SELECT * FROM channels WHERE id=$1 AND type='group'", [id]);
  if (!ch || !(await one('SELECT 1 FROM dm_members WHERE channel_id=$1 AND user_id=$2', [id, req.user.id]))) throw notFound('گروه پیدا نشد');
  return ch;
}
router.patch('/dms/:id', wrap(async (req, res) => {
  const ch = await groupCtx(req);
  await q('UPDATE channels SET name=$1 WHERE id=$2', [String((req.body || {}).name || '').trim().slice(0, 50), ch.id]);
  refreshDm((await all('SELECT user_id FROM dm_members WHERE channel_id=$1', [ch.id])).map(r => r.user_id)); res.json({ ok: true });
}));
router.post('/dms/:id/members', wrap(async (req, res) => {
  const ch = await groupCtx(req); const o = int((req.body || {}).user_id);
  const n = (await one('SELECT count(*)::int AS n FROM dm_members WHERE channel_id=$1', [ch.id])).n;
  if (n >= 10) throw bad('ظرفیت گروه تکمیل است');
  if (!(await one('SELECT 1 FROM users WHERE id=$1 AND NOT banned', [o]))) throw notFound();
  if (await isBlocked(req.user.id, o)) throw forbidden('امکان افزودن این کاربر وجود ندارد');
  await q('INSERT INTO dm_members(channel_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [ch.id, o]);
  refreshDm((await all('SELECT user_id FROM dm_members WHERE channel_id=$1', [ch.id])).map(r => r.user_id)); res.json({ ok: true });
}));
router.post('/dms/:id/leave', wrap(async (req, res) => {
  const ch = await groupCtx(req);
  const before = (await all('SELECT user_id FROM dm_members WHERE channel_id=$1', [ch.id])).map(r => r.user_id);
  await q('DELETE FROM dm_members WHERE channel_id=$1 AND user_id=$2', [ch.id, req.user.id]);
  if (before.length <= 1) await q('DELETE FROM channels WHERE id=$1', [ch.id]);
  refreshDm(before); res.json({ ok: true });
}));

module.exports = { router };
