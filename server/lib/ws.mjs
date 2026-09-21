// A WebSocket server written against RFC 6455 directly: handshake, frame
// parsing, masking, ping/pong and close. No ws package, no socket.io.
import { createHash, randomUUID } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const MAX_MESSAGE = 1 << 20; // 1 MiB is plenty for pattern and stock updates

export class WsHub {
  constructor() {
    this.rooms = new Map();   // room -> Set<Conn>
    this.handlers = new Map(); // room -> (msg, conn) => void
  }

  on(room, handler) { this.handlers.set(room, handler); }

  /** Attach to an http server's upgrade event. */
  attach(server, { path = "/ws" } = {}) {
    server.on("upgrade", (req, socket) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== path) return socket.destroy();

      const key = req.headers["sec-websocket-key"];
      if (!key || (req.headers.upgrade || "").toLowerCase() !== "websocket") {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        return socket.destroy();
      }
      const accept = createHash("sha1").update(key + GUID).digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      socket.setNoDelay(true);

      const room = (url.searchParams.get("room") || "lobby").slice(0, 40);
      const conn = new Conn(socket, room, this);
      this.join(room, conn);
      conn.send({ type: "welcome", id: conn.id, room, peers: this.rooms.get(room).size });
      this.broadcast(room, { type: "peers", peers: this.rooms.get(room).size }, null);
    });
  }

  join(room, conn) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room).add(conn);
  }

  leave(room, conn) {
    const set = this.rooms.get(room);
    if (!set) return;
    set.delete(conn);
    if (!set.size) this.rooms.delete(room);
    else this.broadcast(room, { type: "peers", peers: set.size }, null);
  }

  /** Send to everyone in a room, optionally skipping the sender. */
  broadcast(room, obj, except) {
    const set = this.rooms.get(room);
    if (!set) return 0;
    let n = 0;
    for (const c of set) if (c !== except) { c.send(obj); n++; }
    return n;
  }

  stats() {
    return Object.fromEntries([...this.rooms].map(([r, s]) => [r, s.size]));
  }
}

class Conn {
  constructor(socket, room, hub) {
    this.socket = socket;
    this.room = room;
    this.hub = hub;
    this.id = randomUUID().slice(0, 8);
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.alive = true;

    socket.on("data", (chunk) => this.feed(chunk));
    socket.on("close", () => this.close());
    socket.on("error", () => this.close());
    this.ping = setInterval(() => this.alive && this.frame(OP.PING, Buffer.alloc(0)), 25000);
  }

  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const f = readFrame(this.buf);
      if (!f) return;                      // wait for more bytes
      this.buf = this.buf.subarray(f.size);
      this.handle(f);
    }
  }

  handle(f) {
    if (f.opcode === OP.CLOSE) return this.close(true);
    if (f.opcode === OP.PING) return this.frame(OP.PONG, f.payload);
    if (f.opcode === OP.PONG) return;

    if (f.opcode === OP.CONT || !f.fin) {
      this.frags.push(f.payload);
      if (this.frags.reduce((a, b) => a + b.length, 0) > MAX_MESSAGE) return this.close(true);
      if (!f.fin) return;
    }
    const payload = this.frags.length ? Buffer.concat([...this.frags, f.payload]) : f.payload;
    this.frags = [];
    if (payload.length > MAX_MESSAGE) return this.close(true);

    let msg;
    try { msg = JSON.parse(payload.toString("utf8")); }
    catch { return this.send({ type: "error", message: "expected JSON" }); }

    const handler = this.hub.handlers.get(this.room);
    if (handler) handler(msg, this);
    else this.hub.broadcast(this.room, msg, this);
  }

  send(obj) { this.frame(OP.TEXT, Buffer.from(JSON.stringify(obj), "utf8")); }

  frame(opcode, payload) {
    if (!this.alive) return;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.alloc(2);
      head[1] = len;
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    head[0] = 0x80 | opcode;               // FIN set, server frames are never masked
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this.close(); }
  }

  close(sendClose = false) {
    if (!this.alive) return;
    this.alive = false;
    clearInterval(this.ping);
    if (sendClose) { try { this.frame(OP.CLOSE, Buffer.alloc(0)); } catch {} }
    this.hub.leave(this.room, this);
    this.socket.destroy();
  }
}

/** Parse one frame if a complete one is buffered, otherwise return null. */
function readFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;

  if (len === 126) {
    if (buf.length < off + 2) return null;
    len = buf.readUInt16BE(off); off += 2;
  } else if (len === 127) {
    if (buf.length < off + 8) return null;
    const big = buf.readBigUInt64BE(off);
    if (big > BigInt(MAX_MESSAGE)) return { fin: true, opcode: OP.CLOSE, payload: Buffer.alloc(0), size: buf.length };
    len = Number(big); off += 8;
  }

  let mask = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    mask = buf.subarray(off, off + 4); off += 4;
  }
  if (buf.length < off + len) return null;

  const payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { fin, opcode, payload, size: off + len };
}

export { readFrame };
