import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import {
  getBoundingBox,
  getOsmWalkableNodes,
  generateTreasuresFromNodes,
  generateTreasuresFallback,
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
      const bbox = getBoundingBox(centerLat, centerLng, 1000);

      // Get walkable OSM nodes in area (cached 1h per bbox key)
      const nodes = await getOsmWalkableNodes(bbox);

      // Generate candidate treasure positions
      const candidates =
        nodes.length > 0
          ? generateTreasuresFromNodes(nodes, dayNumber)
          : generateTreasuresFallback(bbox, dayNumber);

      // Filter out treasures collected within the last 24 hours
      const collectedResult = await pool.query(
        "SELECT id FROM collected_treasures WHERE collected_at >= NOW() - INTERVAL '24 hours'",
      );
      const collectedIds = new Set<string>(
        (collectedResult.rows as Array<{ id: string }>).map((r) => r.id),
      );

      const treasures = candidates.filter((t) => !collectedIds.has(t.id));

      return reply.send({ treasures });
    },
  );

  // POST /api/treasures/:id/collect — collect a treasure
  fastify.post<{
    Params: { id: string };
    Body: { playerId: string; lat: number; lng: number; dayNumber: number };
  }>('/api/treasures/:id/collect', async (request, reply) => {
    const { id } = request.params;
    const { playerId, lat, lng, dayNumber } = request.body;

    if (!playerId) {
      return reply.status(400).send({ error: 'playerId is required' });
    }
    if (lat === undefined || lng === undefined || dayNumber === undefined) {
      return reply.status(400).send({ error: 'lat, lng, and dayNumber are required' });
    }

    // Anti-cheat: validate the treasure ID matches what would be generated
    // for the player's reported position/day. Only applies to osm: IDs.
    if (id.startsWith('osm:')) {
      const parts = id.split(':');
      const claimedNodeIndex = parseInt(parts[1] ?? '', 10);
      const claimedDay = parseInt(parts[2] ?? '', 10);

      if (isNaN(claimedNodeIndex) || isNaN(claimedDay)) {
        return reply.status(400).send({ error: 'invalid treasure id' });
      }

      // Day must match today or yesterday (allow small clock drift)
      const today = Math.floor(Date.now() / 86400000);
      if (claimedDay !== today && claimedDay !== today - 1) {
        return reply.status(400).send({ error: 'treasure has expired' });
      }

      // Verify the node at claimedNodeIndex is within 200m of reported position
      // by regenerating the node pool for the player's area
      const bbox = getBoundingBox(lat, lng, 1200); // slightly larger to account for edge cases
      const nodes = await getOsmWalkableNodes(bbox);
      if (nodes.length > 0) {
        const node = nodes[claimedNodeIndex];
        if (!node) {
          return reply.status(400).send({ error: 'invalid treasure node index' });
        }
        const dLat = node.lat - lat;
        const dLng = (node.lng - lng) * Math.cos((lat * Math.PI) / 180);
        const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
        if (distanceMeters > 200) {
          return reply.status(400).send({ error: 'treasure position too far from player' });
        }
      }
      // If nodes array is empty (Overpass unavailable), skip distance check
    } else if (id.startsWith('fallback:')) {
      // Validate fallback ID format: fallback:{dayNumber}:{i}
      const parts = id.split(':');
      const claimedDay = parseInt(parts[1] ?? '', 10);
      const today = Math.floor(Date.now() / 86400000);
      if (isNaN(claimedDay) || (claimedDay !== today && claimedDay !== today - 1)) {
        return reply.status(400).send({ error: 'treasure has expired' });
      }
    } else {
      return reply.status(400).send({ error: 'invalid treasure id format' });
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
