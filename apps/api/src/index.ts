import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { dropRoutes } from './routes/drops.js';
import { startExpiryJob } from './jobs/expiry.js';
import { runMigrations } from './migrate.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: '*' });

// Health check — responds immediately so Railway doesn't kill us during DB startup
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

// Run migrations after server is up — DB may need time to become ready on cold start
runMigrations().catch((err) => {
  fastify.log.error(err, 'Migration failed — retrying on next request or restart');
});

// Start background expiry job
startExpiryJob(io);
