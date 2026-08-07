const mongoose = require('mongoose')

const withTransaction = async (work, options = {}) => {
  const connection = options.connection || mongoose.connection
  const session = await connection.startSession()
  let result
  try {
    await session.withTransaction(async () => {
      result = await work(session)
    }, options.transactionOptions)
    return result
  } finally {
    await session.endSession()
  }
}

module.exports = { withTransaction }
