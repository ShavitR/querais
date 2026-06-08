#!/usr/bin/env node
import type { ChatMessage } from '@querais/shared';
import { QueraisClient } from './client.js';

const baseUrl = process.env.QUERAIS_BASE_URL ?? 'http://127.0.0.1:8787';
const apiKey = process.env.QUERAIS_API_KEY ?? 'sk-querais-dev';
const model = process.env.QUERAIS_MODEL ?? 'gemma3:4b';

function usage(): void {
  console.log('querais <command>');
  console.log('  chat <prompt...>   stream a chat completion');
  console.log('  models             list available models');
  console.log('  nodes              list active nodes');
  console.log('  stats              network stats');
  console.log('  env: QUERAIS_BASE_URL, QUERAIS_API_KEY, QUERAIS_MODEL');
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const client = new QueraisClient({ baseUrl, apiKey });

  switch (cmd) {
    case 'chat': {
      const prompt = rest.join(' ');
      if (!prompt) {
        console.error('usage: querais chat <prompt>');
        process.exit(1);
      }
      const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
      for await (const delta of client.chatStream(messages, { model })) {
        process.stdout.write(delta);
      }
      process.stdout.write('\n');
      break;
    }
    case 'models':
      console.log((await client.models()).join('\n') || '(none)');
      break;
    case 'nodes':
      console.log(JSON.stringify(await client.nodes(), null, 2));
      break;
    case 'stats':
      console.log(JSON.stringify(await client.stats(), null, 2));
      break;
    default:
      usage();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
