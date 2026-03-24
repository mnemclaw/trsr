import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: 'http://localhost:5173' });

// Health check
fastify.get('/api/health', async () => ({ status: 'ok', service: 'trsr-api' }));

// TODO: mount drop routes (Phase 1)

const io = new Server(fastify.server, { cors: { origin: 'http://localhost:5173' } });

io.on('connection', (socket) => {
  fastify.log.info({ socketId: socket.id }, 'Client connected');
  socket.on('disconnect', () => fastify.log.info({ socketId: socket.id }, 'Client disconnected'));
});

const PORT = Number(process.env['PORT'] ?? 3000);
await fastify.listen({ port: PORT, host: '0.0.0.0' });
