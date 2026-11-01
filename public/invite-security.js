const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function generateInviteCode(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.getRandomValues) throw new Error('Secure browser randomness is unavailable.');
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export function isInviteCode(code) {
  return typeof code === 'string' && TOKEN_PATTERN.test(code);
}

export async function hashInviteCode(code, cryptoProvider = globalThis.crypto) {
  if (typeof code !== 'string') throw new TypeError('Invitation code must be text.');
  const normalized = code.trim().toLowerCase();
  if (!isInviteCode(normalized)) throw new TypeError('Invitation code must contain 64 hexadecimal characters.');
  if (!cryptoProvider?.subtle?.digest) throw new Error('Secure invitation hashing is unavailable.');
  const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
