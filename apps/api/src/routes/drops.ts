import { createRequire } from 'module';
import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { pool } from '../db.js';
import { isInsideBuilding } from '../geo.js';
import type { Drop, BboxQuery } from '@trsr/types';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ngeohash = require('ngeohash') as {
  encode: (lat: number, lng: number, precision?: number) => string;
};

function rowToDrop(row: Record<string, unknown>): Drop {
  return {
    id: row['id'] as string,
    text: row['text'] as string,
    link: row['link'] as string | undefined,
    imageCid: row['image_cid'] as string | undefined,
    lat: row['lat'] as number,
    lng: row['lng'] as number,
    ownerId: row['owner_id'] as string,
    upvotes: row['upvotes'] as number,
    downvotes: row['downvotes'] as number,
    createdAt: (row['created_at'] as Date).toISOString(),
    expiresAt: (row['expires_at'] as Date).toISOString(),
    status: row['status'] as Drop['status'],
  };
}

export async function dropRoutes(fastify: FastifyInstance, opts: { io: Server }) {
  const { io } = opts;

  // POST /api/drops
  fastify.post<{
    Body: { text: string; link?: string; imageCid?: string; lat: number; lng: number; ownerId: string };
  }>('/api/drops', async (request, reply) => {
    const { text, link, imageCid, lat, lng, ownerId } = request.body;

    if (!text || text.length > 500) {
      return reply.status(400).send({ error: 'text must be 1–500 characters' });
    }
    if (typeof lat !== 'number' || isNaN(lat) || lat < -90 || lat > 90) {
      return reply.status(400).send({ error: 'invalid lat' });
    }
    if (typeof lng !== 'number' || isNaN(lng) || lng < -180 || lng > 180) {
      return reply.status(400).send({ error: 'invalid lng' });
    }

    const insideBuilding = await isInsideBuilding(lat, lng);
    if (insideBuilding) {
      return reply.status(422).send({
        error: 'Drops must be placed in streets, parks, or open spaces — not inside buildings.',
      });
    }

    const geohash = ngeohash.encode(lat, lng, 7);

    await pool.query(
      `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [ownerId],
    );

    const result = await pool.query(
      `INSERT INTO drops (text, link, image_cid, lat, lng, geohash, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [text, link ?? null, imageCid ?? null, lat, lng, geohash, ownerId],
    );

    const drop = rowToDrop(result.rows[0] as Record<string, unknown>);
    io.emit('drop:created', drop);
    return reply.status(201).send(drop);
  });

  // GET /api/drops?minLat=&maxLat=&minLng=&maxLng=
  fastify.get<{ Querystring: BboxQuery }>('/api/drops', async (request, reply) => {
    const { minLat, maxLat, minLng, maxLng } = request.query;

    const result = await pool.query(
      `SELECT * FROM drops
       WHERE lat BETWEEN $1 AND $2
         AND lng BETWEEN $3 AND $4
         AND status = 'active'
         AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 200`,
      [minLat, maxLat, minLng, maxLng],
    );

    const drops = (result.rows as Record<string, unknown>[]).map(rowToDrop);
    return reply.send({ drops });
  });

  // GET /api/drops/:id
  fastify.get<{ Params: { id: string } }>('/api/drops/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await pool.query(`SELECT * FROM drops WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Drop not found' });
    }
    return reply.send(rowToDrop(result.rows[0] as Record<string, unknown>));
  });

  // POST /api/drops/:id/vote
  fastify.post<{
    Params: { id: string };
    Body: { userId: string; voteType: 'up' | 'down' };
  }>('/api/drops/:id/vote', async (request, reply) => {
    const { id } = request.params;
    const { userId, voteType } = request.body;

    await pool.query(
      `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [userId],
    );

    // Insert vote (unique constraint prevents duplicates)
    try {
      await pool.query(
        `INSERT INTO votes (drop_id, user_id, vote_type) VALUES ($1, $2, $3)`,
        [id, userId, voteType],
      );
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        return reply.status(409).send({ error: 'Already voted on this drop' });
      }
      throw err;
    }

    // Update vote counts
    const countResult = await pool.query(
      `UPDATE drops
       SET upvotes   = (SELECT COUNT(*) FROM votes WHERE drop_id = $1 AND vote_type = 'up'),
           downvotes = (SELECT COUNT(*) FROM votes WHERE drop_id = $1 AND vote_type = 'down')
       WHERE id = $1
       RETURNING upvotes, downvotes`,
      [id],
    );

    if (countResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Drop not found' });
    }

    const { upvotes, downvotes } = countResult.rows[0] as { upvotes: number; downvotes: number };

    // Recalculate expires_at: base (created_at + 7 days) + (upvotes * 6h) - (downvotes * 3h)
    // Clamp: min 1h from now, max 30 days from now
    const updated = await pool.query(
      `UPDATE drops
       SET expires_at = GREATEST(
         now() + INTERVAL '1 hour',
         LEAST(
           now() + INTERVAL '30 days',
           created_at + INTERVAL '7 days'
             + ($2::int * INTERVAL '6 hours')
             - ($3::int * INTERVAL '3 hours')
         )
       )
       WHERE id = $1
       RETURNING *`,
      [id, upvotes, downvotes],
    );

    const drop = rowToDrop(updated.rows[0] as Record<string, unknown>);
    io.emit('drop:updated', drop);
    return reply.send(drop);
  });
}
