const mongoose = require('mongoose')

const connectDB = async config => {
  mongoose.set('strictQuery', true)
  mongoose.set('sanitizeFilter', true)
  const connection = await mongoose.connect(config.mongoUri, {
    dbName: config.databaseName,
    autoCreate: false,
    autoIndex: false,
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 20000,
  })

  if (connection.connection.name !== config.databaseName) {
    await mongoose.disconnect()
    throw new Error('Connected MongoDB database does not match the configured Velakron database')
  }
  return connection
}

const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
}

module.exports = { connectDB, disconnectDB }
