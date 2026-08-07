const crypto = require('node:crypto')

const ALGORITHM = 'aes-256-gcm'
const ASSOCIATED_DATA = Buffer.from('velakron:outbox:identity.email.send:v1')

const decodeKey = encodedKey => {
  const encoded = String(encodedKey || '').trim()
  const keyMaterial = Buffer.from(encoded, 'base64')
  const canonical = keyMaterial.toString('base64').replace(/=+$/, '') === encoded.replace(/=+$/, '')
  if (!canonical || keyMaterial.length < 32 || keyMaterial.length > 64) {
    throw new Error('VELAKRON_OUTBOX_ENCRYPTION_KEY must contain 32 to 64 base64-encoded random bytes')
  }
  if (keyMaterial.length === 32) return keyMaterial
  return crypto.createHash('sha256')
    .update('velakron-outbox-aes-256-gcm-v1')
    .update(keyMaterial)
    .digest()
}

const encryptOutboxPayload = (payload, encodedKey, randomBytes = crypto.randomBytes) => {
  const key = decodeKey(encodedKey)
  const iv = randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(ASSOCIATED_DATA)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Object.freeze({
    encoding: ALGORITHM,
    key_version: '1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  })
}

const decryptOutboxPayload = (envelope, encodedKey) => {
  if (envelope?.encoding !== ALGORITHM || envelope?.key_version !== '1') {
    throw new Error('Encrypted outbox payload format is not supported')
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    decodeKey(encodedKey),
    Buffer.from(envelope.iv, 'base64'),
  )
  decipher.setAAD(ASSOCIATED_DATA)
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8'))
}

module.exports = { decryptOutboxPayload, encryptOutboxPayload }
