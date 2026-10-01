const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function fixture() {
  let now = 0;
  const timers = [];
  const sockets = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    readyState = 0; sent = [];
    open() { this.readyState = 1; this.emit('open'); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.close(); }
  }
  const timer = (callback, delay) => { const entry = { callback, delay, cleared: false, unref() {} }; timers.push(entry); return entry; };
  const clear = (entry) => { if (entry) entry.cleared = true; };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../lib/server/sessionWatchdog.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, {
    exports, require: name => name === 'ws' ? Socket : require(name), console,
    performance: { now: () => now },
    setTimeout: timer, setInterval: timer, clearTimeout: clear, clearInterval: clear
  });
  const watcher = new exports.SessionWatchdog('live/test id', 'fake-key', () => now, (url, options) => {
    assert.equal(url, 'wss://api.openai.com/v1/live/sessions/live%2Ftest%20id/attach');
    assert.equal(options.headers.Authorization, 'Bearer fake-key');
    const socket = new Socket(); sockets.push(socket); return socket;
  });
  return { watcher, sockets, timers, setNow: value => { now = value; }, control: exports.controlWatchdog };
}

test('frozen browser expires the server lease even with an open OpenAI socket', async () => {
  const f = fixture(); f.sockets[0].open(); await f.watcher.ready;
  f.setNow(44999); f.watcher.checkDeadline(); assert.equal(f.sockets[0].sent.length, 0);
  f.setNow(45000); f.watcher.checkDeadline();
  assert.equal(f.watcher.status, 'closing');
  assert.equal(f.sockets[0].sent[0].type, 'session.close');
  f.setNow(50000); assert.equal(f.watcher.heartbeat(), false);
  assert.equal(f.watcher.status, 'closing');
  assert.equal(f.sockets[0].readyState, 1); // Wait for finalization, not just socket closure.
  f.sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'session.closed', usage: { seconds: 45 } })));
  assert.equal(f.watcher.status, 'confirmed');
  assert.ok(f.timers.every(timer => timer.cleared));
});

test('only browser heartbeats extend the deadline; OpenAI usage messages do not', async () => {
  const f = fixture(); f.sockets[0].open(); await f.watcher.ready;
  f.setNow(40000); assert.equal(f.watcher.heartbeat(), true);
  f.setNow(80000);
  f.sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'session.usage.updated', usage: { seconds: 80 } })));
  f.watcher.checkDeadline(); assert.equal(f.watcher.status, 'armed');
  f.setNow(85000); f.watcher.checkDeadline(); assert.equal(f.watcher.status, 'closing');
  f.sockets[0].emit('message', Buffer.from('{"type":"session.closed"}'));
});

test('a lost sideband reconnects and requests closure rather than declaring success', async () => {
  const f = fixture(); f.sockets[0].open(); await f.watcher.ready;
  f.sockets[0].close(); assert.equal(f.watcher.status, 'closing');
  const retry = f.timers.find(timer => timer.delay === 2000 && !timer.cleared);
  retry.cleared = true; retry.callback();
  assert.equal(f.sockets.length, 2);
  f.sockets[1].open(); assert.equal(f.sockets[1].sent[0].type, 'session.close');
  f.sockets[1].emit('message', Buffer.from('{"type":"session.closed"}'));
  assert.equal(f.watcher.status, 'confirmed');
});

test('manual server close is idempotent and invalid capability tokens cannot renew a session', async () => {
  const f = fixture(); f.sockets[0].open(); await f.watcher.ready;
  assert.equal(f.control('not-a-valid-token', 'heartbeat'), null);
  f.watcher.requestClose(); f.watcher.requestClose();
  assert.equal(f.sockets[0].sent.length, 1);
  f.sockets[0].emit('message', Buffer.from('{"type":"session.closed"}'));
});

test('missing final acknowledgment reconnects and retries closure', async () => {
  const f = fixture(); f.sockets[0].open(); await f.watcher.ready;
  f.watcher.requestClose();
  const deadline = f.timers.find(timer => timer.delay === 15000 && !timer.cleared);
  deadline.callback();
  assert.equal(f.watcher.status, 'closing');
  const retry = f.timers.find(timer => timer.delay === 2000 && !timer.cleared);
  retry.cleared = true; retry.callback(); f.sockets[1].open();
  assert.equal(f.sockets[1].sent[0].type, 'session.close');
  f.sockets[1].emit('message', Buffer.from('{"type":"session.closed"}'));
  f.sockets[0].open();
  assert.equal(f.watcher.status, 'confirmed');
});

test('an unavailable session stops retries without claiming confirmed final usage', async () => {
  const f = fixture(); let destroyed = false;
  f.sockets[0].emit('unexpected-response', { destroy() { destroyed = true; } }, { statusCode: 404 });
  await assert.rejects(f.watcher.ready, /no longer available/);
  assert.equal(destroyed, true);
  assert.equal(f.watcher.status, 'unconfirmed');
  assert.ok(f.timers.every(timer => timer.cleared));
  assert.equal(f.watcher.heartbeat(), false);
});
