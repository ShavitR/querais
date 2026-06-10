import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Logger } from 'pino';
import { verifyMessage, type Address, type Hex } from 'viem';
import {
  nodeToGatewaySchema,
  type CompletionReport,
  type GatewayToNode,
  type JobAssignment,
  type JobErrorMessage,
  type NodeHello,
  type NodeModelOffer,
  type TokenChunk,
} from '@querais/shared';
import type { NodeOffer } from '@querais/matching';
import type { ChainClient } from './chain-client.js';

interface PooledNode {
  socket: WebSocket;
  wallet: Address;
  nodeId: string;
  models: NodeModelOffer[];
  reputation: number;
}

/** /node WebSocket flood protection (Slice 3). All optional — defaults are generous. */
export interface NodePoolOptions {
  /** Max simultaneous sockets (incl. pre-handshake). */
  maxConnections: number;
  /** Max simultaneous sockets per source IP. */
  maxPerIp: number;
  /** Close sockets that haven't completed the signed-nonce handshake within this window. */
  handshakeTimeoutMs: number;
  /** Close sockets that exceed this sustained message rate. */
  maxMessagesPerSecond: number;
}

const POOL_DEFAULTS: NodePoolOptions = {
  maxConnections: 256,
  maxPerIp: 4,
  handshakeTimeoutMs: 10_000,
  // Every streamed token is one WS message — a fast node legitimately sustains ~1k msg/s,
  // so this default only blocks raw floods (tune via hardening config).
  maxMessagesPerSecond: 5_000,
};

/** Messages a job handler cares about (everything after assignment). */
export type JobMessage = TokenChunk | CompletionReport | JobErrorMessage;
export type JobMessageHandler = (msg: JobMessage) => void;

/**
 * Tracks connected node daemons. Runs the signed-nonce handshake (proving wallet
 * control + on-chain registration) before a node enters the pool, exposes the pool
 * as matching offers, and routes per-job token/completion messages to the dispatcher.
 */
export class NodePool {
  private readonly nodes = new Map<Address, PooledNode>();
  private readonly socketToWallet = new WeakMap<WebSocket, Address>();
  private readonly pendingNonce = new WeakMap<WebSocket, string>();
  private readonly jobHandlers = new Map<string, JobMessageHandler>();
  private readonly jobToWallet = new Map<string, Address>();
  private readonly jobsByWallet = new Map<Address, number>();
  // Flood protection (Slice 3): track every socket from accept to close, plus per-IP counts.
  private readonly connections = new Set<WebSocket>();
  private readonly socketIp = new WeakMap<WebSocket, string>();
  private readonly ipCounts = new Map<string, number>();
  private readonly handshakeTimers = new WeakMap<WebSocket, NodeJS.Timeout>();
  private readonly opts: NodePoolOptions;

  constructor(
    private readonly chain: ChainClient,
    private readonly logger: Logger,
    opts?: Partial<NodePoolOptions>,
  ) {
    this.opts = { ...POOL_DEFAULTS, ...opts };
  }

  /** Wire up a freshly-connected node socket and send it an auth challenge. */
  handleConnection(socket: WebSocket, ip?: string): void {
    // Connection caps — refuse before doing any work for the socket.
    if (this.connections.size >= this.opts.maxConnections) {
      this.logger.warn({ ip }, 'rejecting node socket: gateway at connection capacity');
      socket.close(1013, 'gateway at capacity');
      return;
    }
    if (ip && (this.ipCounts.get(ip) ?? 0) >= this.opts.maxPerIp) {
      this.logger.warn({ ip }, 'rejecting node socket: too many connections from this IP');
      socket.close(1013, 'too many connections from this address');
      return;
    }
    this.connections.add(socket);
    if (ip) {
      this.socketIp.set(socket, ip);
      this.ipCounts.set(ip, (this.ipCounts.get(ip) ?? 0) + 1);
    }

    // An unauthenticated socket may not idle: complete the handshake or get dropped.
    const timer = setTimeout(() => {
      if (!this.socketToWallet.get(socket)) {
        this.logger.warn({ ip }, 'closing node socket: handshake timeout');
        socket.close(1008, 'handshake timeout');
      }
    }, this.opts.handshakeTimeoutMs);
    timer.unref?.();
    this.handshakeTimers.set(socket, timer);

    const nonce = randomBytes(16).toString('hex');
    this.pendingNonce.set(socket, nonce);
    this.sendTo(socket, { type: 'challenge', nonce });

    // Per-socket message-rate cap (a misbehaving node can't flood the gateway).
    let windowStart = Date.now();
    let windowCount = 0;
    socket.on('message', (data: Buffer) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        windowCount = 0;
      }
      windowCount += 1;
      if (windowCount > this.opts.maxMessagesPerSecond) {
        this.logger.warn({ ip }, 'closing node socket: message rate exceeded');
        socket.close(1008, 'message rate exceeded');
        return;
      }
      void this.onMessage(socket, data.toString());
    });
    socket.on('close', () => this.onClose(socket));
    socket.on('error', () => this.onClose(socket));
  }

  private async onMessage(socket: WebSocket, raw: string): Promise<void> {
    const parsed = nodeToGatewaySchema.safeParse(safeJson(raw));
    if (!parsed.success) {
      this.logger.warn('dropping unparseable node message');
      return;
    }
    const msg = parsed.data;
    if (msg.type === 'hello') {
      await this.onHello(socket, msg);
      return;
    }
    // Count completed jobs per node (for the leaderboard).
    if (msg.type === 'completion') {
      const w = this.jobToWallet.get(msg.jobId);
      if (w) this.jobsByWallet.set(w, (this.jobsByWallet.get(w) ?? 0) + 1);
    }
    // token / completion / job_error → route to the job's handler
    const handler = this.jobHandlers.get(msg.jobId);
    if (handler) handler(msg);
  }

  private async onHello(socket: WebSocket, hello: NodeHello): Promise<void> {
    const expectedNonce = this.pendingNonce.get(socket);
    if (!expectedNonce || hello.nonce !== expectedNonce) {
      this.reject(socket, 'bad or missing nonce');
      return;
    }
    let validSig = false;
    try {
      validSig = await verifyMessage({
        address: hello.wallet,
        message: hello.nonce,
        signature: hello.signature as Hex,
      });
    } catch {
      validSig = false;
    }
    if (!validSig) {
      this.reject(socket, 'signature does not match wallet');
      return;
    }

    const node = await this.chain.getNode(hello.wallet);
    if (!node.exists || !node.isActive) {
      this.reject(socket, 'wallet is not an active registered node');
      return;
    }

    const pooled: PooledNode = {
      socket,
      wallet: hello.wallet,
      nodeId: hello.nodeId,
      models: hello.models,
      reputation: Number(node.reputationScore),
    };
    this.nodes.set(hello.wallet, pooled);
    this.socketToWallet.set(socket, hello.wallet);
    this.sendTo(socket, { type: 'hello_ack', ok: true });
    this.logger.info(
      { wallet: hello.wallet, models: hello.models.map((m) => m.model) },
      'node joined pool',
    );
  }

  /** Flatten the pool into matching offers (one per node×model). */
  offers(): NodeOffer[] {
    const out: NodeOffer[] = [];
    for (const node of this.nodes.values()) {
      for (const m of node.models) {
        out.push({
          wallet: node.wallet,
          nodeId: node.nodeId,
          model: m.model,
          pricePerTokenWei: BigInt(m.pricePerTokenWei),
          reputation: node.reputation,
          active: true,
        });
      }
    }
    return out;
  }

  /** Send a job to a node and register the handler that receives its messages. */
  assign(wallet: Address, assignment: JobAssignment, handler: JobMessageHandler): void {
    const node = this.nodes.get(wallet);
    if (!node) throw new Error(`node ${wallet} is not connected`);
    this.jobHandlers.set(assignment.spec.jobId, handler);
    this.jobToWallet.set(assignment.spec.jobId, wallet);
    this.sendTo(node.socket, assignment);
  }

  releaseJob(jobId: string): void {
    this.jobHandlers.delete(jobId);
    this.jobToWallet.delete(jobId);
  }

  /** Refresh a pooled node's cached reputation from on-chain (after settlement). */
  async refreshReputation(wallet: Address): Promise<void> {
    const node = this.nodes.get(wallet);
    if (!node) return;
    const onchain = await this.chain.getNode(wallet);
    node.reputation = Number(onchain.reputationScore);
  }

  listNodes(): Array<{
    wallet: Address;
    nodeId: string;
    reputation: number;
    models: NodeModelOffer[];
    jobsServed: number;
  }> {
    return [...this.nodes.values()].map((n) => ({
      wallet: n.wallet,
      nodeId: n.nodeId,
      reputation: n.reputation,
      models: n.models,
      jobsServed: this.jobsByWallet.get(n.wallet) ?? 0,
    }));
  }

  availableModels(): string[] {
    const set = new Set<string>();
    for (const n of this.nodes.values()) for (const m of n.models) set.add(m.model);
    return [...set];
  }

  size(): number {
    return this.nodes.size;
  }

  private sendTo(socket: WebSocket, msg: GatewayToNode): void {
    socket.send(JSON.stringify(msg));
  }

  private reject(socket: WebSocket, reason: string): void {
    this.logger.warn({ reason }, 'rejecting node handshake');
    this.sendTo(socket, { type: 'hello_ack', ok: false, reason });
    socket.close();
  }

  private onClose(socket: WebSocket): void {
    // Flood-protection bookkeeping (Slice 3).
    this.connections.delete(socket);
    const timer = this.handshakeTimers.get(socket);
    if (timer) clearTimeout(timer);
    const ip = this.socketIp.get(socket);
    if (ip) {
      const n = (this.ipCounts.get(ip) ?? 1) - 1;
      if (n <= 0) this.ipCounts.delete(ip);
      else this.ipCounts.set(ip, n);
      this.socketIp.delete(socket);
    }

    const wallet = this.socketToWallet.get(socket);
    if (wallet) {
      this.nodes.delete(wallet);
      this.socketToWallet.delete(socket);
      this.logger.info({ wallet }, 'node left pool');
    }
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
