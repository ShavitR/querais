import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pino from 'pino';
import type { WebSocket } from 'ws';
import { NodePool } from './node-pool.js';
import type { ChainClient } from './chain-client.js';

const logger = pino({ level: 'silent' });

/** Minimal stand-in for a ws socket: capture sends + closes, allow injecting messages. */
class FakeSocket extends EventEmitter {
  sent: string[] = [];
  closed: { code?: number; reason?: string } | undefined;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = { code, reason };
    this.emit('close');
  }

  /** Inject an inbound message as the ws 'message' event (Buffer, like ws delivers). */
  inject(msg: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }
}

function asWs(s: FakeSocket): WebSocket {
  return s as unknown as WebSocket;
}

const chain = {
  getNode: async () => ({ exists: true, isActive: true, reputationScore: 7000n }),
} as unknown as ChainClient;

test('connection cap: sockets beyond maxConnections are refused', () => {
  const pool = new NodePool(chain, logger, { maxConnections: 1 });
  const a = new FakeSocket();
  const b = new FakeSocket();
  pool.handleConnection(asWs(a), '203.0.113.1');
  pool.handleConnection(asWs(b), '203.0.113.2');
  assert.equal(a.closed, undefined, 'first socket stays open');
  assert.equal(b.closed?.code, 1013, 'second socket refused (try again later)');
  assert.equal(b.sent.length, 0, 'refused socket gets no challenge');
});

test('per-IP cap: one source cannot hold more than maxPerIp sockets', () => {
  const pool = new NodePool(chain, logger, { maxPerIp: 1 });
  const a = new FakeSocket();
  const b = new FakeSocket();
  const c = new FakeSocket();
  pool.handleConnection(asWs(a), '203.0.113.7');
  pool.handleConnection(asWs(b), '203.0.113.7');
  pool.handleConnection(asWs(c), '198.51.100.9');
  assert.equal(a.closed, undefined);
  assert.equal(b.closed?.code, 1013, 'same-IP second socket refused');
  assert.equal(c.closed, undefined, 'other IPs unaffected');

  // Closing the first frees the slot for that IP.
  a.close();
  const d = new FakeSocket();
  pool.handleConnection(asWs(d), '203.0.113.7');
  assert.equal(d.closed, undefined, 'slot freed after close');
});

test('handshake timeout: an unauthenticated socket is dropped', async () => {
  const pool = new NodePool(chain, logger, { handshakeTimeoutMs: 20 });
  const s = new FakeSocket();
  pool.handleConnection(asWs(s), '203.0.113.1');
  assert.equal(s.closed?.code, undefined, 'open before the deadline');
  await delay(40);
  assert.equal(s.closed?.code, 1008, 'closed after the handshake deadline');
});

test('message-rate cap: a flooding socket is closed', () => {
  const pool = new NodePool(chain, logger, { maxMessagesPerSecond: 5 });
  const s = new FakeSocket();
  pool.handleConnection(asWs(s), '203.0.113.1');
  for (let i = 0; i < 6; i++) s.inject({ type: 'garbage' });
  assert.equal(s.closed?.code, 1008, 'closed once the per-second budget is exceeded');
});

test('uptime telemetry: a completed handshake opens a session; socket close closes it', async () => {
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');
  const { GatewayDb } = await import('./db/index.js');
  const { NodeSessionStore } = await import('./db/node-sessions.js');

  const sessions = new NodeSessionStore(new GatewayDb());
  const pool = new NodePool(chain, logger, {}, { sessions });
  const s = new FakeSocket();
  pool.handleConnection(asWs(s), '203.0.113.1');

  // Complete the real signed-nonce handshake with a throwaway wallet.
  const challenge = JSON.parse(s.sent[0]!) as { nonce: string };
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const signature = await account.signMessage({ message: challenge.nonce });
  s.inject({
    type: 'hello',
    wallet: account.address,
    nodeId: 'test-node',
    nonce: challenge.nonce,
    signature,
    models: [{ model: 'mock-model', pricePerTokenWei: '1', tokensPerSecond: 1 }],
  });
  // onMessage is async — wait for the handshake to land.
  for (let i = 0; i < 50 && pool.size() === 0; i++) await delay(10);
  assert.equal(pool.size(), 1, 'node joined the pool');

  const open = sessions.intervalsSince(account.address, 0);
  assert.equal(open.length, 1, 'handshake opened a session');
  assert.equal(open[0]!.end, null, 'session is open while connected');

  s.close();
  const closed = sessions.intervalsSince(account.address, 0);
  assert.notEqual(closed[0]!.end, null, 'socket close closes the session');
});
