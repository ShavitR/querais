import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/**
 * Encrypted node-wallet keystore (scrypt + AES-256-GCM). Lets an operator run a node
 * without ever pasting a raw key: the daemon generates a wallet on first run, encrypts
 * it at rest, and prints the address to fund/stake.
 */
export interface Keystore {
  version: 1;
  address: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encryptKey(privateKey: Hex, password: string): Keystore {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return {
    version: 1,
    address: privateKeyToAccount(privateKey).address,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

export function decryptKey(ks: Keystore, password: string): Hex {
  const key = scryptSync(password, Buffer.from(ks.salt, 'hex'), 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ks.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(ks.tag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ks.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8') as Hex;
}

/**
 * Load the node key from an encrypted keystore file, generating + persisting a new
 * wallet if the file doesn't exist. Returns the key and whether it was just created.
 */
export function loadOrCreateKey(
  path: string,
  password: string,
): { privateKey: Hex; address: string; created: boolean } {
  if (existsSync(path)) {
    const ks = JSON.parse(readFileSync(path, 'utf8')) as Keystore;
    const privateKey = decryptKey(ks, password);
    return { privateKey, address: ks.address, created: false };
  }
  const privateKey = generatePrivateKey();
  const ks = encryptKey(privateKey, password);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ks, null, 2), 'utf8');
  return { privateKey, address: ks.address, created: true };
}
