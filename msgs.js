'use strict';
// Message queries shared by REST routes and socket handlers.
const { one, all } = require('./db');

const SEL = `SELECT m.id, m.channel_id, c.server_id, m.author_id, m.content, m.reply_to, m.attachments, m.pinned, m.created_at, m.edited_at,
  json_build_object('id',u.id,'username',u.username,'display_name',u.display_name,'avatar',u.avatar,'verified',u.verified) AS author,
  (SELECT json_build_object('id',r.id,'author_name',ru.display_name,'content',left(r.content,140))
     FROM messages r JOIN users ru ON ru.id=r.author_id WHERE r.id=m.reply_to) AS reply,
  COALESCE((SELECT json_agg(json_build_object('emoji',x.emoji,'users',x.users))
     FROM (SELECT emoji, array_agg(user_id) AS users FROM reactions WHERE message_id=m.id GROUP BY emoji) x), '[]'::json) AS reactions
  FROM messages m JOIN users u ON u.id=m.author_id JOIN channels c ON c.id=m.channel_id`;

const getMessage = id => one(SEL + ' WHERE m.id=$1', [id]);

async function history(channelId, { before, limit = 50, q, pinned } = {}) {
  const params = [channelId]; let w = ' WHERE m.channel_id=$1';
  if (before) { params.push(before); w += ` AND m.id<$${params.length}`; }
  if (q) { params.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%'); w += ` AND m.content ILIKE $${params.length}`; }
  if (pinned) w += ' AND m.pinned';
  params.push(limit);
  const rows = await all(SEL + w + ` ORDER BY m.id DESC LIMIT $${params.length}`, params);
  return rows.reverse();
}
const reactionsOf = id => all('SELECT emoji, array_agg(user_id) AS users FROM reactions WHERE message_id=$1 GROUP BY emoji', [id]);

module.exports = { getMessage, history, reactionsOf };
