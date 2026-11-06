'use strict';
// Site admin panel API (users with is_admin; the built-in "nava" account is the protected root admin).
const express = require('express');
const bcrypt = require('bcryptjs');
const { all, one, q, getSetting, setSetting } = require('../db');
const bus = require('../bus');
const { ROOT_USERNAME } = require('../config');
const { bad, wrap, int, forbidden, notFound, USER_COLS, pub } = require('../util');
const { deleteServer } = require('./servers');

const router = express.Router();
router.use('/admin', (req, res, next) => req.user.is_admin ? next() : next(forbidden('فقط مدیر سایت به این بخش دسترسی دارد')));

const isRoot = u => u.username === ROOT_USERNAME;
const log = (req, action, target) => q('INSERT INTO admin_log(admin_id,admin_name,action,target) VALUES($1,$2,$3,$4)',
  [req.user.id, req.user.username, action, String(target || '').slice(0, 200)]).catch(() => {});
const drop = id => bus.io && bus.io.in('user:' + id).disconnectSockets(true);
// Load the target user; the root admin can only be modified by itself
async function target(req) {
  const u = await one('SELECT * FROM users WHERE id=$1', [int(req.params.id)]);
  if (!u) throw notFound('کاربر پیدا نشد');
  if (isRoot(u) && !isRoot(req.user)) throw forbidden('حساب اصلی مدیر قابل تغییر نیست');
  return u;
}

// 1) dashboard statistics
router.get('/admin/stats', wrap(async (req, res) => {
  const s = await one(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM users WHERE banned) AS banned,
    (SELECT count(*)::int FROM users WHERE verified) AS verified_users, (SELECT count(*)::int FROM servers) AS servers,
    (SELECT count(*)::int FROM servers WHERE verified) AS verified_servers, (SELECT count(*)::int FROM channels WHERE server_id IS NOT NULL) AS channels,
    (SELECT count(*)::int FROM messages) AS messages, (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours') AS messages_24h,
    (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_users_7d`);
  res.json({ stats: { ...s, online: bus.online.size } });
}));

// 2) user list + search
router.get('/admin/users', wrap(async (req, res) => {
  const term = req.query.q ? '%' + String(req.query.q).replace(/[\\%_]/g, '\\$&') + '%' : null;
  const rows = await all(`SELECT ${USER_COLS}, u.is_admin, u.banned, u.created_at,
    (SELECT count(*)::int FROM members m WHERE m.user_id=u.id) AS server_count,
    (SELECT count(*)::int FROM messages m WHERE m.author_id=u.id) AS message_count
    FROM users u WHERE ($1::text IS NULL OR u.username ILIKE $1 OR u.display_name ILIKE $1) ORDER BY u.id LIMIT 500`, [term]);
  res.json({ users: rows.map(r => ({ ...pub(r), is_admin: r.is_admin, banned: r.banned, created_at: r.created_at, server_count: r.server_count, message_count: r.message_count, is_root: isRoot(r) })) });
}));

// 3) ban / unban
router.post('/admin/users/:id/ban', wrap(async (req, res) => {
  const u = await target(req), banned = !!(req.body || {}).banned;
  if (u.is_admin) throw forbidden('مدیر را نمی‌توان مسدود کرد (ابتدا دسترسی مدیریت را بردارید)');
  await q('UPDATE users SET banned=$1, token_version=token_version+1 WHERE id=$2', [banned, u.id]);
  if (banned) drop(u.id);
  log(req, banned ? 'ban-user' : 'unban-user', u.username); res.json({ ok: true });
}));

// 4) blue tick for users
router.post('/admin/users/:id/verify', wrap(async (req, res) => {
  const u = await target(req), v = !!(req.body || {}).verified;
  if (isRoot(u) && !v) throw forbidden('تیک آبی حساب اصلی برداشته نمی‌شود');
  await q('UPDATE users SET verified=$1 WHERE id=$2', [v, u.id]);
  bus.broadcastUser(u.id); log(req, v ? 'verify-user' : 'unverify-user', u.username); res.json({ ok: true });
}));

// 5) promote / demote admins (root admin only)
router.post('/admin/users/:id/admin', wrap(async (req, res) => {
  if (!isRoot(req.user)) throw forbidden('فقط مدیر اصلی می‌تواند مدیر تعیین کند');
  const u = await target(req); if (isRoot(u)) throw forbidden('حساب اصلی قابل تغییر نیست');
  const a = !!(req.body || {}).admin;
  await q('UPDATE users SET is_admin=$1 WHERE id=$2', [a, u.id]);
  log(req, a ? 'grant-admin' : 'revoke-admin', u.username); res.json({ ok: true });
}));

// 6) reset password (also ends all sessions of that user)
router.post('/admin/users/:id/password', wrap(async (req, res) => {
  const u = await target(req), pw = String((req.body || {}).password || '');
  if (pw.length < 6 || pw.length > 100) throw bad('گذرواژه باید حداقل ۶ نویسه باشد');
  await q('UPDATE users SET password_hash=$1, token_version=token_version+1 WHERE id=$2', [await bcrypt.hash(pw, 10), u.id]);
  drop(u.id); log(req, 'reset-password', u.username); res.json({ ok: true });
}));

// 7) force logout
router.post('/admin/users/:id/logout', wrap(async (req, res) => {
  const u = await target(req);
  await q('UPDATE users SET token_version=token_version+1 WHERE id=$1', [u.id]);
  drop(u.id); log(req, 'force-logout', u.username); res.json({ ok: true });
}));

// 8) rename / clear status
router.post('/admin/users/:id/rename', wrap(async (req, res) => {
  const u = await target(req), b = req.body || {};
  const name = String(b.display_name || '').trim().slice(0, 32);
  if (name) await q('UPDATE users SET display_name=$1 WHERE id=$2', [name, u.id]);
  if (b.clear_status) await q("UPDATE users SET status_text='' WHERE id=$1", [u.id]);
  bus.broadcastUser(u.id); log(req, 'edit-profile', u.username); res.json({ ok: true });
}));

// 9) purge all messages of a user
router.delete('/admin/users/:id/messages', wrap(async (req, res) => {
  const u = await target(req);
  const r = await q('DELETE FROM messages WHERE author_id=$1', [u.id]);
  log(req, 'purge-messages', `${u.username} (${r.rowCount})`); res.json({ ok: true, deleted: r.rowCount });
}));

// 10) delete account (and the servers it owns)
router.delete('/admin/users/:id', wrap(async (req, res) => {
  const u = await target(req);
  if (u.is_admin || isRoot(u)) throw forbidden('ابتدا دسترسی مدیریت این کاربر را بردارید');
  for (const s of await all('SELECT id FROM servers WHERE owner_id=$1', [u.id])) await deleteServer(s.id);
  drop(u.id); await q('DELETE FROM users WHERE id=$1', [u.id]);
  log(req, 'delete-user', u.username); res.json({ ok: true });
}));

// 11) servers: list, blue tick, delete
router.get('/admin/servers', wrap(async (req, res) => {
  res.json({ servers: await all(`SELECT s.id, s.name, s.icon, s.verified, s.created_at, u.display_name AS owner_name,
    (SELECT count(*)::int FROM members m WHERE m.server_id=s.id) AS member_count,
    (SELECT count(*)::int FROM channels c WHERE c.server_id=s.id) AS channel_count
    FROM servers s JOIN users u ON u.id=s.owner_id ORDER BY s.id`) });
}));
router.post('/admin/servers/:id/verify', wrap(async (req, res) => {
  const id = int(req.params.id), v = !!(req.body || {}).verified;
  const s = await one('UPDATE servers SET verified=$1 WHERE id=$2 RETURNING name', [v, id]);
  if (!s) throw notFound('سرور پیدا نشد');
  bus.toServer(id, 'server:changed', { serverId: id }); log(req, v ? 'verify-server' : 'unverify-server', s.name); res.json({ ok: true });
}));
router.delete('/admin/servers/:id', wrap(async (req, res) => {
  const id = int(req.params.id), s = await one('SELECT name FROM servers WHERE id=$1', [id]);
  if (!s) throw notFound('سرور پیدا نشد');
  await deleteServer(id); log(req, 'delete-server', s.name); res.json({ ok: true });
}));

// 12) users online right now
router.get('/admin/online', wrap(async (req, res) => {
  const ids = [...bus.online.keys()];
  const rows = ids.length ? await all(`SELECT ${USER_COLS} FROM users u WHERE u.id = ANY($1::int[]) ORDER BY u.display_name`, [ids]) : [];
  res.json({ users: rows.map(pub) });
}));

// 13) site-wide announcement (pushed live to everyone online, shown once to others at next visit)
router.post('/admin/announce', wrap(async (req, res) => {
  const text = String((req.body || {}).text || '').trim().slice(0, 500);
  await setSetting('announcement', text);
  if (text && bus.io) bus.io.emit('site:announce', { text });
  log(req, text ? 'announce' : 'clear-announcement', text.slice(0, 60)); res.json({ ok: true });
}));

// 14) site settings (open / close registration)
router.get('/admin/settings', wrap(async (req, res) => res.json({
  settings: { registration_open: (await getSetting('registration_open', '1')) === '1', announcement: await getSetting('announcement', '') } })));
router.post('/admin/settings', wrap(async (req, res) => {
  const open = !!(req.body || {}).registration_open;
  await setSetting('registration_open', open ? '1' : '0');
  log(req, open ? 'open-registration' : 'close-registration', ''); res.json({ ok: true });
}));

// 15) audit log
router.get('/admin/log', wrap(async (req, res) => res.json({ log: await all('SELECT id, admin_name, action, target, created_at FROM admin_log ORDER BY id DESC LIMIT 100') })));

module.exports = { router };
