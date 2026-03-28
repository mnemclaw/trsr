import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import {
  getTilesInRadius,
  generateTreasuresForTile,
  getOsmDensity,
} from '../treasure-generator.js';

export async function treasureRoutes(fastify: FastifyInstance) {
  // GET /api/treasures?lat=&lng= — returns uncollected treasures within 1km
  fastify.get<{ Querystring: { lat: string; lng: string } }>(
    '/api/treasures',
    async (request, reply) => {
      const { lat, lng } = request.query;
      const centerLat = parseFloat(lat);
      const centerLng = parseFloat(lng);

      if (isNaN(centerLat) || isNaN(centerLng)) {
        return reply.status(400).send({ error: 'invalid lat/lng' });
      }

      const dayNumber = Math.floor(Date.now() / 86400000);
      const tiles = getTilesInRadius(centerLat, centerLng, 1000);

      // Get collected IDs for today
      const collectedResult = await pool.query(
        "SELECT id FROM collected_treasures WHERE collected_at >= NOW() - INTERVAL '24 hours'",
      );
      const collectedIds = new Set<string>(
        (collectedResult.rows as Array<{ id: string }>).map((r) => r.id),
      );

      const treasures: Array<{ id: string; lat: number; lng: number }> = [];
      for (const [tileLat, tileLng] of tiles) {
        const density = await getOsmDensity(tileLat * 0.001, tileLng * 0.001);
        const tileTreasures = generateTreasuresForTile(tileLat, tileLng, dayNumber, density);
        for (const t of tileTreasures) {
          if (!collectedIds.has(t.id)) {
            treasures.push(t);
          }
        }
      }

      return reply.send({ treasures });
    },
  );

  // POST /api/treasures/:id/collect — collect a treasure
  fastify.post<{
    Params: { id: string };
    Body: { playerId: string };
  }>('/api/treasures/:id/collect', async (request, reply) => {
    const { id } = request.params;
    const { playerId } = request.body;

    if (!playerId) {
      return reply.status(400).send({ error: 'playerId is required' });
    }

    // Idempotency check
    const existing = await pool.query('SELECT id FROM collected_treasures WHERE id = $1', [id]);
    if ((existing.rows as unknown[]).length > 0) {
      return reply.status(409).send({ error: 'Already collected' });
    }

    await pool.query('INSERT INTO collected_treasures (id, player_id) VALUES ($1, $2)', [
      id,
      playerId,
    ]);

    // Upsert balance
    await pool.query(
      `INSERT INTO player_balance (player_id, treasure_count) VALUES ($1, 1)
       ON CONFLICT (player_id) DO UPDATE SET
         treasure_count = player_balance.treasure_count + 1,
         updated_at = NOW()`,
      [playerId],
    );

    const bal = await pool.query(
      'SELECT treasure_count FROM player_balance WHERE player_id = $1',
      [playerId],
    );
    const balance = ((bal.rows as Array<{ treasure_count: number }>)[0]?.treasure_count) ?? 1;
    return reply.send({ balance });
  });

  // GET /api/players/:id/balance
  fastify.get<{ Params: { id: string } }>('/api/players/:id/balance', async (request, reply) => {
    const { id } = request.params;
    const bal = await pool.query(
      'SELECT treasure_count FROM player_balance WHERE player_id = $1',
      [id],
    );
    const balance = ((bal.rows as Array<{ treasure_count: number }>)[0]?.treasure_count) ?? 0;
    return reply.send({ balance });
  });
}
