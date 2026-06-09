const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey() {
  const raw = process.env.CREDENTIAL_ENC_KEY;
  if (!raw) {
    throw new Error('CREDENTIAL_ENC_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`CREDENTIAL_ENC_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

let cachedKey = null;
function getKey() {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

// Returns base64(iv || tag || ciphertext)
function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decrypt(payloadB64) {
  const buf = Buffer.from(payloadB64, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Encrypted payload too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// URL-safe random string for usernames / passwords
function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { encrypt, decrypt, randomToken };
