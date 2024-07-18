const amqplib = require("amqplib");
const logger = require("./logger-config");
let channel, connection;
const queue = "notifications";

async function connectQueue() {
  try {
    connection = await amqplib.connect("amqp://localhost");
    channel = await connection.createChannel();
    logger.info("queue connected");
    await channel.assertQueue(queue);
  } catch (error) {
    console.log(error);
    throw error;
  }
}

async function sendData(data) {
  try {
    await channel.sendToQueue(queue, Buffer.from(JSON.stringify(data)));
  } catch (error) {
    console.log(error);
  }
}

module.exports = { connectQueue, sendData };
