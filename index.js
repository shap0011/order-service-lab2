// Load env, core libs, and middleware
require('dotenv').config();
const express = require('express');
const amqp = require('amqplib/callback_api'); // callback API is fine for the lab
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ---- Config (12-Factor via env) ----
const PORT = process.env.PORT || 3000; // Azure injects PORT
const RABBITMQ_CONNECTION_STRING =
  process.env.RABBITMQ_CONNECTION_STRING || 'amqp://localhost';
const ORDER_QUEUE = process.env.ORDER_QUEUE || 'order_queue';

// ---- Health endpoints ----
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// Optional: verify we can connect to RabbitMQ and publish a tiny ping
app.get('/healthz/rabbitmq', (_req, res) => {
  amqp.connect(RABBITMQ_CONNECTION_STRING, (err, conn) => {
    if (err) return res.status(503).json({ status: 'error', detail: 'connect failed' });

    conn.createChannel((err2, ch) => {
      if (err2) {
        conn.close();
        return res.status(503).json({ status: 'error', detail: 'channel failed' });
      }
      ch.assertQueue(ORDER_QUEUE, { durable: false });
      ch.sendToQueue(ORDER_QUEUE, Buffer.from('ping'));
      // Close politely after a short delay so the broker flushes the frame
      setTimeout(() => { try { ch.close(); conn.close(); } catch(_){} }, 200);
      res.json({ status: 'ok', queue: ORDER_QUEUE });
    });
  });
});

// ---- Orders endpoint ----
app.post('/orders', (req, res) => {
  const order = req.body;

  amqp.connect(RABBITMQ_CONNECTION_STRING, (err, conn) => {
    if (err) {
      console.error('RabbitMQ connect error:', err.message);
      return res.status(500).send('Error connecting to RabbitMQ');
    }

    conn.createChannel((err2, ch) => {
      if (err2) {
        console.error('RabbitMQ channel error:', err2.message);
        try { conn.close(); } catch(_) {}
        return res.status(500).send('Error creating channel');
      }

      ch.assertQueue(ORDER_QUEUE, { durable: false });
      const msg = JSON.stringify(order);
      ch.sendToQueue(ORDER_QUEUE, Buffer.from(msg));
      console.log('Sent order to queue:', msg);

      // respond immediately; then close channel/connection shortly after
      res.send('Order received');
      setTimeout(() => { try { ch.close(); conn.close(); } catch(_) {} }, 200);
    });
  });
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`order-service listening on http://localhost:${PORT}`);
});