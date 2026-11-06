'use strict';
// In-memory voice channel state. Media flows peer-to-peer (WebRTC mesh); the server only tracks who is where.
const bus = require('./bus');

const rooms = new Map(); // channelId -> { serverId, peers: Map(socketId -> state) }

const list = id => {
  const r = rooms.get(id);
  return r ? [...r.peers].map(([socketId, s]) => ({ socketId, userId: s.userId, muted: s.muted, deafened: s.deafened, video: s.video, screen: s.screen })) : [];
};
const broadcast = (channelId, serverId) =>
  bus.toServer(serverId, 'voice:update', { serverId, channelId, participants: list(channelId) });

function join(socket, ch, userId) {
  leave(socket);
  let r = rooms.get(ch.id);
  if (!r) { r = { serverId: ch.server_id, peers: new Map() }; rooms.set(ch.id, r); }
  const peers = list(ch.id); // existing peers (the joiner initiates connections to them)
  r.peers.set(socket.id, { userId, muted: false, deafened: false, video: false, screen: false });
  socket.join('voice:' + ch.id);
  socket.data.voice = { channelId: ch.id, serverId: ch.server_id };
  broadcast(ch.id, ch.server_id);
  return peers;
}

function leave(socket) {
  const v = socket.data && socket.data.voice;
  if (!v) return;
  const r = rooms.get(v.channelId);
  if (r) { r.peers.delete(socket.id); if (!r.peers.size) rooms.delete(v.channelId); }
  socket.leave('voice:' + v.channelId);
  socket.data.voice = null;
  broadcast(v.channelId, v.serverId);
}

function setState(socket, st) {
  const v = socket.data.voice; if (!v) return;
  const r = rooms.get(v.channelId); const p = r && r.peers.get(socket.id); if (!p) return;
  p.muted = !!st.muted; p.deafened = !!st.deafened; p.video = !!st.video; p.screen = !!st.screen;
  broadcast(v.channelId, v.serverId);
}

function snapshotServer(serverId) {
  const out = {};
  for (const [cid, r] of rooms) if (r.serverId === serverId) out[cid] = list(cid);
  return out;
}

function kick(match) { // disconnect matching peers from voice and tell them
  for (const [cid, r] of [...rooms]) {
    for (const [sid, s] of [...r.peers]) {
      if (!match(cid, r, s)) continue;
      const sock = bus.io.sockets.sockets.get(sid);
      if (sock) { leave(sock); sock.emit('voice:kicked'); }
    }
  }
}
const kickUser = (userId, serverId) => kick((c, r, s) => s.userId === userId && r.serverId === serverId);
const removeChannel = channelId => kick(c => c === channelId);
const removeServer = serverId => kick((c, r) => r.serverId === serverId);

module.exports = { join, leave, setState, snapshotServer, kickUser, removeChannel, removeServer };
