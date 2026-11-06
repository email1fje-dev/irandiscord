'use strict';
// Shared runtime state so REST routes and socket handlers can talk to each other.
const bus = {
  io: null,
  ready: false,
  online: new Map(), // userId -> Set(socketId)
  broadcastUser: () => {}, // replaced by socket.js
  effPresence(u) {
    if (!this.online.has(u.id)) return 'offline';
    return u.presence === 'offline' ? 'offline' : (u.presence || 'online');
  },
  toUser(id, ev, data) { if (this.io) this.io.to('user:' + id).emit(ev, data); },
  toServer(id, ev, data) { if (this.io) this.io.to('server:' + id).emit(ev, data); },
};
module.exports = bus;
