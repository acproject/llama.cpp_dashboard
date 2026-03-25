const net = require('node:net');

function encodeRespCommand(args) {
  const parts = [];
  parts.push(Buffer.from(`*${args.length}\r\n`, 'utf8'));
  for (const a of args) {
    const s = a === null || a === undefined ? '' : String(a);
    const b = Buffer.from(s, 'utf8');
    parts.push(Buffer.from(`$${b.length}\r\n`, 'utf8'));
    parts.push(b);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  return Buffer.concat(parts);
}

function indexOfCrlf(buf, start) {
  for (let i = start; i + 1 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10) return i;
  }
  return -1;
}

function parseLine(buf, offset) {
  const end = indexOfCrlf(buf, offset);
  if (end === -1) return null;
  return { line: buf.slice(offset, end), next: end + 2 };
}

function parseRespValue(buf, offset, returnBuffers) {
  if (offset >= buf.length) return null;
  const prefix = buf[offset];

  if (prefix === 43 || prefix === 45 || prefix === 58) {
    const r = parseLine(buf, offset + 1);
    if (!r) return null;
    const s = r.line.toString('utf8');
    if (prefix === 45) return { value: { __respError: s }, next: r.next };
    if (prefix === 58) return { value: Number.parseInt(s, 10), next: r.next };
    return { value: s, next: r.next };
  }

  if (prefix === 36) {
    const r = parseLine(buf, offset + 1);
    if (!r) return null;
    const lenStr = r.line.toString('utf8');
    const len = Number.parseInt(lenStr, 10);
    if (Number.isNaN(len)) return { value: { __respError: 'ERR protocol error: invalid bulk length' }, next: r.next };
    if (len === -1) return { value: null, next: r.next };
    const start = r.next;
    const end = start + len;
    if (end + 2 > buf.length) return null;
    if (buf[end] !== 13 || buf[end + 1] !== 10) {
      return { value: { __respError: 'ERR protocol error: invalid bulk terminator' }, next: end + 2 };
    }
    const raw = buf.slice(start, end);
    const v = returnBuffers ? raw : raw.toString('utf8');
    return { value: v, next: end + 2 };
  }

  if (prefix === 42) {
    const r = parseLine(buf, offset + 1);
    if (!r) return null;
    const countStr = r.line.toString('utf8');
    const count = Number.parseInt(countStr, 10);
    if (Number.isNaN(count)) return { value: { __respError: 'ERR protocol error: invalid array length' }, next: r.next };
    if (count === -1) return { value: null, next: r.next };
    const out = [];
    let next = r.next;
    for (let i = 0; i < count; i++) {
      const child = parseRespValue(buf, next, returnBuffers);
      if (!child) return null;
      out.push(child.value);
      next = child.next;
    }
    return { value: out, next };
  }

  return { value: { __respError: `ERR protocol error: unknown prefix ${String.fromCharCode(prefix)}` }, next: buf.length };
}

function respUnwrapError(v) {
  if (v && typeof v === 'object' && v.__respError) {
    const err = new Error(v.__respError);
    err.name = 'MiniMemoryError';
    throw err;
  }
  return v;
}

class MiniMemoryClient {
  constructor(options = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 6379;
    this.password = options.password ?? null;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 5000;
    this.returnBuffers = options.returnBuffers ?? false;

    this._socket = null;
    this._buffer = Buffer.alloc(0);
    this._pending = [];
    this._connected = false;
    this._closing = false;
  }

  connect() {
    if (this._socket && this._connected) return Promise.resolve();
    if (this._socket && !this._connected) {
      return new Promise((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onErr = (e) => {
          cleanup();
          reject(e);
        };
        const cleanup = () => {
          this._socket?.off('connect', onReady);
          this._socket?.off('error', onErr);
        };
        this._socket.on('connect', onReady);
        this._socket.on('error', onErr);
      });
    }

    this._closing = false;
    this._buffer = Buffer.alloc(0);
    this._pending = [];

    const sock = net.createConnection({ host: this.host, port: this.port });
    this._socket = sock;
    sock.setNoDelay(true);

    return new Promise((resolve, reject) => {
      let done = false;
      const failAll = (err) => {
        while (this._pending.length) {
          const p = this._pending.shift();
          if (p && p.reject) p.reject(err);
        }
      };

      const onError = (err) => {
        this._connected = false;
        if (!done) {
          done = true;
          cleanup();
          reject(err);
          return;
        }
        failAll(err);
      };

      const onClose = () => {
        this._connected = false;
        if (this._closing) return;
        failAll(new Error('Connection closed'));
      };

      const onData = (chunk) => {
        this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
        for (;;) {
          const parsed = parseRespValue(this._buffer, 0, this.returnBuffers);
          if (!parsed) break;
          const reply = parsed.value;
          this._buffer = this._buffer.slice(parsed.next);

          const p = this._pending.shift();
          if (!p) continue;
          if (p.timer) clearTimeout(p.timer);

          try {
            p.resolve(respUnwrapError(reply));
          } catch (e) {
            p.reject(e);
          }
        }
      };

      const cleanup = () => {
        sock.off('error', onError);
        sock.off('close', onClose);
        sock.off('data', onData);
        sock.off('connect', onConnect);
      };

      const onConnect = async () => {
        this._connected = true;
        sock.on('data', onData);
        sock.on('close', onClose);
        sock.on('error', onError);

        try {
          if (this.password) {
            await this.call(['AUTH', this.password], { timeoutMs: this.connectTimeoutMs });
          }
          done = true;
          sock.off('connect', onConnect);
          resolve();
        } catch (e) {
          done = true;
          cleanup();
          try {
            sock.destroy();
          } catch {}
          reject(e);
        }
      };

      sock.once('connect', onConnect);
      sock.once('error', onError);

      const t = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        try {
          sock.destroy(new Error('Connect timeout'));
        } catch {}
        reject(new Error('Connect timeout'));
      }, this.connectTimeoutMs);
      t.unref?.();
    });
  }

  disconnect() {
    this._closing = true;
    const sock = this._socket;
    this._socket = null;
    this._connected = false;
    if (!sock) return Promise.resolve();

    return new Promise((resolve) => {
      sock.once('close', () => resolve());
      try {
        sock.end();
      } catch {
        try {
          sock.destroy();
        } catch {}
      }
    });
  }

  call(args, options = {}) {
    if (!Array.isArray(args) || args.length === 0) {
      return Promise.reject(new Error('call(args) expects a non-empty array'));
    }
    const timeoutMs = options.timeoutMs ?? this.commandTimeoutMs;

    const run = () => {
      const sock = this._socket;
      if (!sock || !this._connected) return Promise.reject(new Error('Not connected'));

      return new Promise((resolve, reject) => {
        const p = { resolve, reject, timer: null };
        if (timeoutMs > 0) {
          p.timer = setTimeout(() => {
            const idx = this._pending.indexOf(p);
            if (idx >= 0) this._pending.splice(idx, 1);
            reject(new Error(`Command timeout after ${timeoutMs}ms`));
          }, timeoutMs);
          p.timer.unref?.();
        }
        this._pending.push(p);
        try {
          sock.write(encodeRespCommand(args));
        } catch (e) {
          const idx = this._pending.indexOf(p);
          if (idx >= 0) this._pending.splice(idx, 1);
          if (p.timer) clearTimeout(p.timer);
          reject(e);
        }
      });
    };

    if (this._connected) return run();
    return this.connect().then(run);
  }

  ping() {
    return this.call(['PING']);
  }

  set(key, value) {
    return this.call(['SET', key, value]);
  }

  get(key) {
    return this.call(['GET', key]);
  }

  del(...keys) {
    return this.call(['DEL', ...keys]);
  }

  exists(...keys) {
    return this.call(['EXISTS', ...keys]);
  }

  incr(key) {
    return this.call(['INCR', key]);
  }

  select(index) {
    return this.call(['SELECT', String(index)]);
  }

  pexpire(key, ttlMs) {
    return this.call(['PEXPIRE', key, String(ttlMs)]);
  }

  pttl(key) {
    return this.call(['PTTL', key]);
  }

  scan(pattern, count) {
    if (count === undefined) return this.call(['SCAN', pattern]);
    return this.call(['SCAN', pattern, String(count)]);
  }

  keys(pattern) {
    return this.call(['KEYS', pattern]);
  }

  flushdb() {
    return this.call(['FLUSHDB']);
  }

  flushall() {
    return this.call(['FLUSHALL']);
  }

  metaset(subject, field, value) {
    return this.call(['METASET', subject, field, value]);
  }

  metaget(subject, field) {
    return this.call(['METAGET', subject, field]);
  }

  tagadd(subject, ...tags) {
    return this.call(['TAGADD', subject, ...tags]);
  }

  hotset(subject, flag) {
    return this.call(['HOTSET', subject, String(flag)]);
  }

  objset(key, mime, data) {
    return this.call(['OBJSET', key, mime, data]);
  }

  objget(key) {
    return this.call(['OBJGET', key]);
  }

  graphAddEdge(from, rel, to) {
    return this.call(['GRAPH.ADDEDGE', from, rel, to]);
  }

  graphDelEdge(from, rel, to) {
    return this.call(['GRAPH.DELEDGE', from, rel, to]);
  }

  graphHasEdge(from, rel, to) {
    return this.call(['GRAPH.HASEDGE', from, rel, to]);
  }

  graphEdgePropSet(from, rel, to, field, value) {
    return this.call(['GRAPH.EDGEPROP.SET', from, rel, to, field, value]);
  }

  graphEdgePropGet(from, rel, to, field) {
    if (field === undefined) return this.call(['GRAPH.EDGEPROP.GET', from, rel, to]);
    return this.call(['GRAPH.EDGEPROP.GET', from, rel, to, field]);
  }

  graphNeighborsX2(node, rel, limit, options = {}) {
    const args = ['GRAPH.NEIGHBORSX2', node];
    if (rel !== undefined && rel !== null && rel !== '') args.push(rel);
    if (limit !== undefined && limit !== null) args.push(String(limit));
    if (options.edgeMetaKeys?.length) args.push('EDGE_METAKEYS', String(options.edgeMetaKeys.length), ...options.edgeMetaKeys);
    if (options.fromMetaKeys?.length) args.push('FROM_METAKEYS', String(options.fromMetaKeys.length), ...options.fromMetaKeys);
    if (options.toMetaKeys?.length) args.push('TO_METAKEYS', String(options.toMetaKeys.length), ...options.toMetaKeys);
    return this.call(args);
  }

  evidenceSearchF(topk, metric, dim, queryVector, options = {}) {
    const args = ['EVIDENCE.SEARCHF', String(topk), metric, String(dim), ...queryVector.map((x) => String(x))];
    if (options.tag?.length) {
      for (const t of options.tag) args.push('TAG', t);
    }
    if (options.meta) {
      for (const [f, v] of Object.entries(options.meta)) args.push('META', f, String(v));
    }
    if (options.keyPrefix) args.push('KEYPREFIX', options.keyPrefix);
    if (options.graphFrom) args.push('GRAPHFROM', options.graphFrom);
    if (options.graphRel) args.push('GRAPHREL', options.graphRel);
    if (options.graphDepth !== undefined && options.graphDepth !== null) args.push('GRAPHDEPTH', String(options.graphDepth));
    return this.call(args);
  }

  embed(mode, text) {
    return this.call(['EMBED', mode, text]);
  }

  embedSet(key, mode, text) {
    return this.call(['EMBED.SET', key, mode, text]);
  }
}

module.exports = {
  MiniMemoryClient,
  createClient: (options) => new MiniMemoryClient(options),
  encodeRespCommand,
};

