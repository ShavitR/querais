import WebSocket from 'ws';
import type { Logger } from 'pino';
import type { Hex } from 'viem';
import {
  gatewayToNodeSchema,
  type GatewayToNode,
  type JobAssignment,
  type NodeHello,
  type NodeModelOffer,
  type NodeToGateway,
  type QueraisWalletClient,
} from '@querais/shared';
import type { InferenceBackend } from './inference/backend.js';
import { resolveModel } from './inference/index.js';
import { buildCompletionReport } from './report.js';

export interface GatewayClientOptions {
  wsUrl: string;
  walletClient: QueraisWalletClient;
  nodeId: Hex;
  models: NodeModelOffer[];
  backend: InferenceBackend;
  logger: Logger;
}

/** Exponential backoff (ms) for reconnection: 1s, 2s, 4s … capped at 30s. */
export function backoffDelayMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

/**
 * Maintains the node's WebSocket link to the gateway: completes the signed-nonce
 * handshake (proving wallet control), then services job assignments by streaming
 * tokens and returning a completion report.
 */
export class GatewayClient {
  private ws: WebSocket | undefined;
  private attempts = 0;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | undefined;

  constructor(private readonly opts: GatewayClientOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(this.opts.wsUrl);
    this.ws = ws;
    ws.on('open', () => {
      this.attempts = 0;
      this.opts.logger.info({ url: this.opts.wsUrl }, 'connected to gateway');
    });
    ws.on('message', (data: WebSocket.RawData) => {
      void this.onMessage(data.toString());
    });
    ws.on('close', () => this.scheduleReconnect('closed'));
    ws.on('error', (err: Error) =>
      this.opts.logger.error({ err: err.message }, 'gateway ws error'),
    );
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    const delay = backoffDelayMs(this.attempts);
    this.attempts += 1;
    this.opts.logger.warn(
      { reason, delayMs: delay, attempt: this.attempts },
      'reconnecting to gateway',
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private send(msg: NodeToGateway): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: GatewayToNode;
    try {
      msg = gatewayToNodeSchema.parse(JSON.parse(raw));
    } catch (err) {
      this.opts.logger.warn({ err: String(err) }, 'unparseable gateway message');
      return;
    }
    switch (msg.type) {
      case 'challenge':
        await this.handleChallenge(msg.nonce);
        break;
      case 'hello_ack':
        if (msg.ok) this.opts.logger.info('handshake accepted by gateway');
        else this.opts.logger.error({ reason: msg.reason }, 'gateway rejected handshake');
        break;
      case 'job_assignment':
        await this.handleJob(msg);
        break;
    }
  }

  private async handleChallenge(nonce: string): Promise<void> {
    const account = this.opts.walletClient.account;
    const signature = await this.opts.walletClient.signMessage({ account, message: nonce });
    const hello: NodeHello = {
      type: 'hello',
      nodeId: this.opts.nodeId,
      wallet: account.address.toLowerCase() as `0x${string}`,
      nonce,
      signature,
      models: this.opts.models,
    };
    this.send(hello);
  }

  private async handleJob(assignment: JobAssignment): Promise<void> {
    const { spec } = assignment;
    const jobId = spec.jobId;
    try {
      const result = await this.opts.backend.generate(
        {
          model: resolveModel(spec.model),
          messages: spec.messages,
          maxTokens: spec.maxTokens,
          temperature: spec.temperature,
        },
        (chunk) => this.send({ type: 'token', jobId, content: chunk.content }),
      );
      this.send(buildCompletionReport(jobId, result));
      this.opts.logger.info({ jobId, tokens: result.completionTokens }, 'job completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'inference error';
      this.opts.logger.error({ jobId, err: message }, 'job failed');
      this.send({ type: 'job_error', jobId, message });
    }
  }
}
