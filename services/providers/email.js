const { GmailEmailProvider } = require('./gmail')

class DisabledEmailProvider {
  constructor(config) {
    this.config = config
  }

  getStatus() {
    return Object.freeze({
      provider: this.config.adapter,
      enabled: false,
      configured: false,
      sender: this.config.gmail.sender,
      mailbox_verified: false,
    })
  }

  async send() {
    const error = new Error('Email delivery is disabled')
    error.code = 'EMAIL_DELIVERY_DISABLED'
    error.retryable = false
    throw error
  }
}

const createEmailProvider = config => {
  if (!config.email.deliveryEnabled) return new DisabledEmailProvider(config.email)
  if (config.email.adapter === 'gmail') {
    return new GmailEmailProvider({ config: config.email })
  }
  throw new Error(`Worker email adapter ${config.email.adapter} is not implemented`)
}

module.exports = { createEmailProvider, DisabledEmailProvider }
