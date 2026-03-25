import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { dropRoutes } from './routes/drops.js';
import { startExpiryJob } from './jobs/expiry.js';
import { runMigrations } from './migrate.js';

const fastify = Fastify({ logger: true });

// Run DB migrations on startup (idempotent — uses IF NOT EXISTS)
await runMigrations();

await fastify.register(cors, { origin: '*' });

// Health check
fastify.get('/api/health', async () => ({ status: 'ok', service: 'trsr-api' }));

const io = new Server(fastify.server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  fastify.log.info({ socketId: socket.id }, 'Client connected');
  socket.on('disconnect', () => fastify.log.info({ socketId: socket.id }, 'Client disconnected'));
});

// Register drop routes, passing io for socket events
await fastify.register(dropRoutes, { io });

const PORT = Number(process.env['PORT'] ?? 3000);
await fastify.listen({ port: PORT, host: '0.0.0.0' });

// Start background expiry job
startExpiryJob(io);
