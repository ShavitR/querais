import { setTimeout as delay } from 'node:timers/promises';
import type { Address } from 'viem';
import { quaisTokenAbi, type QueraisPublicClient } from '@querais/shared';
import type { Logger } from 'pino';

/** Derive the faucet HTTP URL from the gateway WS URL (ws://h:p/node → http://h:p/v1/faucet). */
export function faucetUrlFromGatewayWs(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http').replace(/\/node$/, '/v1/faucet');
}

/**
 * Make node onboarding zero-touch: if the wallet lacks gas (ETH) or stake (QAIS), claim
 * from the gateway faucet and wait for the funds to land before registering. Never throws
 * — if the faucet can't help, it logs and proceeds (registration will surface the issue).
 */
export async function ensureFunded(opts: {
  publicClient: QueraisPublicClient;
  tokenAddress: Address;
  address: Address;
  faucetUrl: string;
  requiredQaisWei: bigint;
  minEthWei: bigint;
  logger: Logger;
}): Promise<void> {
  const { publicClient, tokenAddress, address, faucetUrl, requiredQaisWei, minEthWei, logger } =
    opts;

  const read = async (): Promise<{ eth: bigint; qais: bigint }> => {
    const [eth, qais] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({
        address: tokenAddress,
        abi: quaisTokenAbi,
        functionName: 'balanceOf',
        args: [address],
      }) as Promise<bigint>,
    ]);
    return { eth, qais };
  };

  let bal = await read();
  if (bal.eth >= minEthWei && bal.qais >= requiredQaisWei) return;

  logger.info({ address, faucetUrl }, 'node underfunded — requesting faucet…');
  try {
    const res = await fetch(faucetUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status },
        'faucet did not grant; fund this address manually if needed',
      );
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'faucet unreachable; fund this address manually');
  }

  const deadline = Date.now() + 90_000;
  for (;;) {
    bal = await read();
    if (bal.eth >= minEthWei && bal.qais >= requiredQaisWei) {
      logger.info('node funded');
      return;
    }
    if (Date.now() > deadline) {
      logger.warn(
        { address },
        'still underfunded after faucet; proceeding (registration may fail)',
      );
      return;
    }
    await delay(2000);
  }
}
