'use strict';
// Servers, invites, channels, roles, member roles and moderation.
const express = require('express');
const crypto = require('crypto');
const { one, all, q, tx } = require('../db');
const { P, ALL_PERMS, DEFAULT_PERMS } = require('../config');
const bus = require('../bus');
const voice = require('../voice');
const { wrap, bad, forbidden, notFound, int, need, needOutrank, memberInfo, USER_COLS, pub } = require('../util');

const router = express.Router();
const changed = id => bus.toServer(id, 'server:changed', { serverId: id });
const clean = (v, max = 50) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);
const iconOk = v => !v || /^\/uploads\/[a-f0-9]{24}\.(png|jpe?g|gif|webp)$/i.test(v);
const colorOk = v => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : null);

async function removeMember(serverId, userId) {
  await q('DELETE FROM member_roles WHERE user_id=$1 AND role_id IN (SELECT id FROM roles WHERE server_id=$2)', [userId, serverId]);
  await q('DELETE FROM members WHERE server_id=$1 AND user_id=$2', [serverId, userId]);
  voice.kickUser(userId, serverId);
  bus.toUser(userId, 'server:removed', { serverId });
  bus.io.in('user:' + userId).socketsLeave('server:' + serverId);
  changed(serverId);
}
async function deleteServer(id) {
  voice.removeServer(id);
  bus.toServer(id, 'server:deleted', { serverId: id });
  await q('DELETE FROM servers WHERE id=$1', [id]);
  bus.io.in('server:' + id).socketsLeave('server:' + id);
}

// ---- servers ----
// Public server discovery: rank by verified status, then community size.
router.get('/servers/discover', wrap(async (req, res) => {
  const rows = await all(`SELECT s.id, s.name, s.icon, s.verified,
      (SELECT count(*)::int FROM members m WHERE m.server_id=s.id) AS member_count,
      (SELECT count(*)::int FROM members m JOIN users u ON u.id=m.user_id WHERE m.server_id=s.id AND u.presence='online') AS online_count
    FROM servers s
    WHERE s.owner_id <> $1
      AND NOT EXISTS (SELECT 1 FROM members mine WHERE mine.server_id=s.id AND mine.user_id=$1)
      AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.server_id=s.id AND b.user_id=$1)
    ORDER BY s.verified DESC, member_count DESC, s.created_at DESC
    LIMIT 30`, [req.user.id]);
  res.json({ servers: rows });
}));

router.post('/servers', wrap(async (req, res) => {
  const name = clean((req.body || {}).name, 60);
  if (!name) throw bad('نام سرور را وارد کنید');
  const uid = req.user.id;
  const server = await tx(async c => {
    const s = (await c.query('INSERT INTO servers(name,owner_id) VALUES($1,$2) RETURNING id,name,icon,owner_id,verified', [name, uid])).rows[0];
    await c.query('INSERT INTO roles(server_id,name,permissions,position,is_default) VALUES($1,$2,$3,0,TRUE)', [s.id, '@everyone', DEFAULT_PERMS]);
    await c.query('INSERT INTO members(server_id,user_id) VALUES($1,$2)', [s.id, uid]);
    const c1 = (await c.query("INSERT INTO channels(server_id,type,name,position) VALUES($1,'category','گفتگوها',0) RETURNING id", [s.id])).rows[0].id;
    await c.query("INSERT INTO channels(server_id,parent_id,type,name,position) VALUES($1,$2,'text','عمومی',0)", [s.id, c1]);
    const c2 = (await c.query("INSERT INTO channels(server_id,type,name,position) VALUES($1,'category','صوتی',1) RETURNING id", [s.id])).rows[0].id;
    await c.query("INSERT INTO channels(server_id,parent_id,type,name,position) VALUES($1,$2,'voice','اتاق صوتی',0)", [s.id, c2]);
    return s;
  });
  bus.io.in('user:' + uid).socketsJoin('server:' + server.id);
  bus.toUser(uid, 'servers:refresh', {});
  res.json({ server });
}));

router.get('/servers/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const info = await need(id, req.user.id);
  const server = await one('SELECT id,name,icon,owner_id,verified FROM servers WHERE id=$1', [id]);
  const channels = await all('SELECT id,server_id,parent_id,type,name,position FROM channels WHERE server_id=$1 ORDER BY position,id', [id]);
  const roles = await all('SELECT id,name,color,permissions,position,is_default FROM roles WHERE server_id=$1 ORDER BY position DESC,id', [id]);
  const members = await all(
    `SELECT ${USER_COLS}, m.joined_at, m.timeout_until,
       ARRAY(SELECT mr.role_id FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.user_id=u.id AND r.server_id=$1) AS role_ids
     FROM members m JOIN users u ON u.id=m.user_id WHERE m.server_id=$1 ORDER BY u.display_name`, [id]);
  res.json({
    server, channels, roles, perms: info.perms, owner: info.owner, voice: voice.snapshotServer(id),
    members: members.map(m => ({ ...pub(m), joined_at: m.joined_at, timeout_until: m.timeout_until, role_ids: m.role_ids })),
  });
}));

router.patch('/servers/:id', wrap(async (req, res) => {
  const id = int(req.params.id); await need(id, req.user.id, P.MANAGE_SERVER);
  const b = req.body || {};
  if (b.name !== undefined) { const n = clean(b.name, 60); if (!n) throw bad('نام سرور نمی‌تواند خالی باشد'); await q('UPDATE servers SET name=$1 WHERE id=$2', [n, id]); }
  if (b.icon !== undefined) { if (!iconOk(b.icon)) throw bad('تصویر نامعتبر است'); await q('UPDATE servers SET icon=$1 WHERE id=$2', [b.icon || null, id]); }
  changed(id); res.json({ ok: true });
}));

router.delete('/servers/:id', wrap(async (req, res) => {
  const id = int(req.params.id); const info = await need(id, req.user.id);
  if (!info.owner) throw forbidden('فقط مالک سرور می‌تواند آن را حذف کند');
  await deleteServer(id); res.json({ ok: true });
}));

router.post('/servers/:id/join', wrap(async (req, res) => {
  const sid = int(req.params.id), uid = req.user.id;
  if (await one('SELECT 1 FROM bans WHERE server_id=$1 AND user_id=$2', [sid, uid])) throw forbidden('شما از این سرور مسدود شده‌اید');
  const server = await one('SELECT id FROM servers WHERE id=$1', [sid]);
  if (!server) throw notFound('سرور پیدا نشد');
  await q('INSERT INTO members(server_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [sid, uid]);
  bus.io.in('user:' + uid).socketsJoin('server:' + sid);
  bus.toUser(uid, 'servers:refresh', {});
  changed(sid);
  res.json({ server_id: sid });
}));

router.post('/servers/:id/leave', wrap(async (req, res) => {
  const id = int(req.params.id); const info = await need(id, req.user.id);
  if (info.owner) throw bad('مالک نمی‌تواند سرور را ترک کند؛ سرور را حذف کنید');
  await removeMember(id, req.user.id); res.json({ ok: true });
}));

// ---- invites ----
router.post('/servers/:id/invites', wrap(async (req, res) => {
  const id = int(req.params.id); await need(id, req.user.id);
  const code = crypto.randomBytes(5).toString('hex');
  await q('INSERT INTO invites(code,server_id,creator_id) VALUES($1,$2,$3)', [code, id, req.user.id]);
  res.json({ code });
}));
router.get('/invites/:code', wrap(async (req, res) => {
  const r = await one(`SELECT s.id, s.name, s.icon, s.verified, (SELECT count(*)::int FROM members WHERE server_id=s.id) AS member_count
    FROM invites i JOIN servers s ON s.id=i.server_id WHERE i.code=$1`, [String(req.params.code).trim()]);
  if (!r) throw notFound('این دعوت‌نامه معتبر نیست');
  res.json({ server: r });
}));
router.post('/invites/:code/join', wrap(async (req, res) => {
  const inv = await one('SELECT * FROM invites WHERE code=$1', [String(req.params.code).trim()]);
  if (!inv) throw notFound('این دعوت‌نامه معتبر نیست');
  const uid = req.user.id, sid = inv.server_id;
  if (await one('SELECT 1 FROM bans WHERE server_id=$1 AND user_id=$2', [sid, uid])) throw forbidden('شما از این سرور مسدود شده‌اید');
  const ins = await one('INSERT INTO members(server_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id', [sid, uid]);
  if (ins) await q('UPDATE invites SET uses=uses+1 WHERE code=$1', [inv.code]);
  bus.io.in('user:' + uid).socketsJoin('server:' + sid);
  bus.toUser(uid, 'servers:refresh', {});
  changed(sid);
  res.json({ server_id: sid });
}));

// ---- channels ----
async function parentOk(serverId, parentId) {
  if (parentId == null) return null;
  const p = await one("SELECT id FROM channels WHERE id=$1 AND server_id=$2 AND type='category'", [parentId, serverId]);
  if (!p) throw bad('دسته‌بندی نامعتبر است');
  return p.id;
}
router.post('/servers/:id/channels', wrap(async (req, res) => {
  const sid = int(req.params.id); await need(sid, req.user.id, P.MANAGE_CHANNELS);
  const b = req.body || {}; const type = b.type;
  if (!['category', 'text', 'voice'].includes(type)) throw bad();
  const name = clean(b.name, 50); if (!name) throw bad('نام کانال را وارد کنید');
  const parent = type === 'category' ? null : await parentOk(sid, b.parent_id == null ? null : int(b.parent_id));
  const pos = (await one('SELECT COALESCE(MAX(position),-1)+1 AS p FROM channels WHERE server_id=$1 AND parent_id IS NOT DISTINCT FROM $2::int', [sid, parent])).p;
  const ch = await one('INSERT INTO channels(server_id,parent_id,type,name,position) VALUES($1,$2,$3,$4,$5) RETURNING id,server_id,parent_id,type,name,position', [sid, parent, type, name, pos]);
  changed(sid); res.json({ channel: ch });
}));
async function chanForManage(req) {
  const ch = await one('SELECT * FROM channels WHERE id=$1', [int(req.params.id)]);
  if (!ch || !ch.server_id) throw notFound('کانال پیدا نشد');
  await need(ch.server_id, req.user.id, P.MANAGE_CHANNELS); return ch;
}
router.patch('/channels/:id', wrap(async (req, res) => {
  const ch = await chanForManage(req); const b = req.body || {};
  if (b.name !== undefined) { const n = clean(b.name, 50); if (!n) throw bad(); await q('UPDATE channels SET name=$1 WHERE id=$2', [n, ch.id]); }
  if (b.parent_id !== undefined && ch.type !== 'category') {
    const p = await parentOk(ch.server_id, b.parent_id == null ? null : int(b.parent_id));
    await q('UPDATE channels SET parent_id=$1 WHERE id=$2', [p, ch.id]);
  }
  changed(ch.server_id); res.json({ ok: true });
}));
router.delete('/channels/:id', wrap(async (req, res) => {
  const ch = await chanForManage(req);
  if (ch.type === 'voice') voice.removeChannel(ch.id);
  await q('DELETE FROM channels WHERE id=$1', [ch.id]);
  bus.toServer(ch.server_id, 'channel:deleted', { serverId: ch.server_id, channelId: ch.id });
  changed(ch.server_id); res.json({ ok: true });
}));
// body: { items: [{id, parent_id, position}] }
router.put('/servers/:id/channels/order', wrap(async (req, res) => {
  const sid = int(req.params.id); await need(sid, req.user.id, P.MANAGE_CHANNELS);
  const items = Array.isArray((req.body || {}).items) ? req.body.items.slice(0, 500) : [];
  for (const it of items) {
    const parent = await parentOk(sid, it.parent_id == null ? null : int(it.parent_id));
    await q('UPDATE channels SET position=$1, parent_id=CASE WHEN type=\'category\' THEN NULL ELSE $2::int END WHERE id=$3 AND server_id=$4', [int(it.position), parent, int(it.id), sid]);
  }
  changed(sid); res.json({ ok: true });
}));

// ---- roles ----
function maskPerms(v, info) {
  const p = (parseInt(v, 10) || 0) & ALL_PERMS;
  if (!info.owner && (p & ~info.perms)) throw forbidden('نمی‌توانید مجوزی را بدهید که خودتان ندارید');
  return p;
}
router.post('/servers/:id/roles', wrap(async (req, res) => {
  const sid = int(req.params.id); const info = await need(sid, req.user.id, P.MANAGE_ROLES);
  const b = req.body || {}; const name = clean(b.name, 32) || 'نقش جدید';
  const max = (await one('SELECT COALESCE(MAX(position),0) AS m FROM roles WHERE server_id=$1', [sid])).m;
  const pos = info.owner ? max + 1 : 1;
  const r = await one('INSERT INTO roles(server_id,name,color,permissions,position) VALUES($1,$2,$3,$4,$5) RETURNING id,name,color,permissions,position,is_default',
    [sid, name, colorOk(b.color), maskPerms(b.permissions, info), pos]);
  changed(sid); res.json({ role: r });
}));
async function roleCtx(req) {
  const role = await one('SELECT * FROM roles WHERE id=$1', [int(req.params.id)]);
  if (!role) throw notFound('نقش پیدا نشد');
  const info = await need(role.server_id, req.user.id, P.MANAGE_ROLES);
  if (!info.owner && !role.is_default && role.position >= info.top) throw forbidden('این نقش بالاتر از نقش شماست');
  return { role, info };
}
router.patch('/roles/:id', wrap(async (req, res) => {
  const { role, info } = await roleCtx(req); const b = req.body || {};
  if (b.name !== undefined && !role.is_default) { const n = clean(b.name, 32); if (!n) throw bad(); await q('UPDATE roles SET name=$1 WHERE id=$2', [n, role.id]); }
  if (b.color !== undefined) await q('UPDATE roles SET color=$1 WHERE id=$2', [colorOk(b.color), role.id]);
  if (b.permissions !== undefined) await q('UPDATE roles SET permissions=$1 WHERE id=$2', [maskPerms(b.permissions, info), role.id]);
  changed(role.server_id); res.json({ ok: true });
}));
router.delete('/roles/:id', wrap(async (req, res) => {
  const { role } = await roleCtx(req);
  if (role.is_default) throw bad('نقش پیش‌فرض قابل حذف نیست');
  await q('DELETE FROM roles WHERE id=$1', [role.id]); changed(role.server_id); res.json({ ok: true });
}));
// body: { ids: [roleId highest -> lowest] } (owner only)
router.put('/servers/:id/roles/order', wrap(async (req, res) => {
  const sid = int(req.params.id); const info = await need(sid, req.user.id);
  if (!info.owner) throw forbidden('فقط مالک سرور می‌تواند ترتیب نقش‌ها را تغییر دهد');
  const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).map(int);
  for (let i = 0; i < ids.length; i++) await q('UPDATE roles SET position=$1 WHERE id=$2 AND server_id=$3 AND NOT is_default', [ids.length - i, ids[i], sid]);
  changed(sid); res.json({ ok: true });
}));
// body: { role_ids: [...] } - replaces the roles of a member (only roles the actor outranks are touched)
router.put('/servers/:id/members/:uid/roles', wrap(async (req, res) => {
  const sid = int(req.params.id), tid = int(req.params.uid);
  let actor;
  if (tid === req.user.id) { actor = await need(sid, req.user.id, P.MANAGE_ROLES); if (!actor.owner) throw forbidden('نمی‌توانید نقش‌های خود را تغییر دهید'); }
  else ({ actor } = await needOutrank(sid, req.user.id, tid, P.MANAGE_ROLES));
  const want = new Set((Array.isArray((req.body || {}).role_ids) ? req.body.role_ids : []).map(int));
  const roles = await all('SELECT id,position FROM roles WHERE server_id=$1 AND NOT is_default', [sid]);
  const manageable = roles.filter(r => actor.owner || r.position < actor.top);
  for (const r of manageable) {
    if (want.has(r.id)) await q('INSERT INTO member_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [tid, r.id]);
    else await q('DELETE FROM member_roles WHERE user_id=$1 AND role_id=$2', [tid, r.id]);
  }
  changed(sid); res.json({ ok: true });
}));

// ---- moderation ----
router.post('/servers/:id/members/:uid/kick', wrap(async (req, res) => {
  const sid = int(req.params.id), tid = int(req.params.uid);
  if (tid === req.user.id) throw bad();
  await needOutrank(sid, req.user.id, tid, P.KICK);
  await removeMember(sid, tid); res.json({ ok: true });
}));
router.post('/servers/:id/members/:uid/ban', wrap(async (req, res) => {
  const sid = int(req.params.id), tid = int(req.params.uid);
  if (tid === req.user.id) throw bad();
  await needOutrank(sid, req.user.id, tid, P.BAN);
  await q('INSERT INTO bans(server_id,user_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [sid, tid, clean((req.body || {}).reason, 200) || null]);
  await removeMember(sid, tid); res.json({ ok: true });
}));
router.get('/servers/:id/bans', wrap(async (req, res) => {
  const sid = int(req.params.id); await need(sid, req.user.id, P.BAN);
  const rows = await all(`SELECT ${USER_COLS}, b.reason, b.created_at FROM bans b JOIN users u ON u.id=b.user_id WHERE b.server_id=$1 ORDER BY b.created_at DESC`, [sid]);
  res.json({ bans: rows.map(r => ({ user: pub(r), reason: r.reason, created_at: r.created_at })) });
}));
router.delete('/servers/:id/bans/:uid', wrap(async (req, res) => {
  const sid = int(req.params.id); await need(sid, req.user.id, P.BAN);
  await q('DELETE FROM bans WHERE server_id=$1 AND user_id=$2', [sid, int(req.params.uid)]);
  res.json({ ok: true });
}));
router.post('/servers/:id/members/:uid/timeout', wrap(async (req, res) => {
  const sid = int(req.params.id), tid = int(req.params.uid);
  if (tid === req.user.id) throw bad();
  await needOutrank(sid, req.user.id, tid, P.TIMEOUT);
  const mins = Math.min(Math.max(parseInt((req.body || {}).minutes, 10) || 0, 0), 40320);
  await q(`UPDATE members SET timeout_until=${mins ? "now() + ($3::int * interval '1 minute')" : 'NULL'} WHERE server_id=$1 AND user_id=$2`,
    mins ? [sid, tid, mins] : [sid, tid]);
  changed(sid); res.json({ ok: true });
}));

module.exports = { router, deleteServer, removeMember };
