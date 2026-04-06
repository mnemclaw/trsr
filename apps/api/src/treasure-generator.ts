// Deterministic PRNG — mulberry32
export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export interface OsmNode {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Compute bounding box ~radiusMeters around a center point
export function getBoundingBox(
  centerLat: number,
  centerLng: number,
  radiusMeters = 1000,
): BoundingBox {
  const latDelta = radiusMeters / 111000;
  const lngDelta = radiusMeters / (111000 * Math.cos((centerLat * Math.PI) / 180));
  return {
    minLat: centerLat - latDelta,
    maxLat: centerLat + latDelta,
    minLng: centerLng - lngDelta,
    maxLng: centerLng + lngDelta,
  };
}

// Deduplicate nodes within ~5m proximity (0.00005 degrees ≈ 5.5m)
function deduplicateNodes(nodes: OsmNode[], thresholdDeg = 0.00005): OsmNode[] {
  const out: OsmNode[] = [];
  for (const node of nodes) {
    let duplicate = false;
    for (const existing of out) {
      if (
        Math.abs(node.lat - existing.lat) < thresholdDeg &&
        Math.abs(node.lng - existing.lng) < thresholdDeg
      ) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) out.push(node);
  }
  return out;
}

// In-memory node cache: bounding-box key → { nodes, expiresAt }
const nodeCache = new Map<string, { nodes: OsmNode[]; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function bboxKey(bbox: BoundingBox): string {
  // Round to 3 decimal places (~111m) to allow cache reuse for nearby positions
  return [
    bbox.minLat.toFixed(3),
    bbox.maxLat.toFixed(3),
    bbox.minLng.toFixed(3),
    bbox.maxLng.toFixed(3),
  ].join(':');
}

/**
 * Fetch walkable OSM nodes within a bounding box from Overpass.
 * Returns an array of deduplicated { lat, lng } points on walkable ground.
 * Results are cached 1 hour per bounding box key.
 */
export async function getOsmWalkableNodes(bbox: BoundingBox): Promise<OsmNode[]> {
  const key = bboxKey(bbox);
  const now = Date.now();

  const cached = nodeCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.nodes;
  }

  const { minLat, maxLat, minLng, maxLng } = bbox;
  const b = `${minLat},${minLng},${maxLat},${maxLng}`;

  // Query walkable nodes: standalone highway nodes + nodes of walkable ways + park/green ways
  const query = `[out:json][timeout:15];
(
  node["highway"~"^(footway|path|pedestrian|steps|crossing|street_lamp)$"](${b});
  node(w["highway"~"^(footway|path|pedestrian|residential|living_street|service|unclassified)$"])(${b});
  node(w["leisure"~"^(park|garden|playground|pitch)$"])(${b});
  node(w["landuse"~"^(grass|recreation_ground|village_green)$"])(${b});
);
out body;`;

  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  async function tryEndpoint(url: string): Promise<OsmNode[] | null> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json()) as {
        elements?: Array<{ type: string; lat?: number; lon?: number }>;
      };
      const rawNodes: OsmNode[] = [];
      for (const el of data.elements ?? []) {
        if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
          rawNodes.push({ lat: el.lat, lng: el.lon });
        }
      }
      return deduplicateNodes(rawNodes);
    } catch {
      return null;
    }
  }

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const nodes = await tryEndpoint(endpoint);
    if (nodes !== null && nodes.length > 0) {
      nodeCache.set(key, { nodes, expiresAt: now + CACHE_TTL_MS });
      return nodes;
    }
  }

  // All endpoints failed or returned no nodes — caller uses fallback
  nodeCache.set(key, { nodes: [], expiresAt: now + CACHE_TTL_MS });
  return [];
}

// Constants for treasure generation
const NODES_PER_TREASURE = 15; // 1 treasure per 15 walkable nodes
const MAX_TREASURES_PER_REQUEST = 50;

/**
 * Deterministically select treasure positions from OSM walkable nodes.
 * Uses mulberry32 PRNG seeded from dayNumber for day-stable placement.
 * Each position gets a stable ID: `osm:{nodeIndex}:{dayNumber}`.
 *
 * @param nodes - Array of walkable OSM nodes in the area
 * @param dayNumber - Math.floor(Date.now() / 86400000) — rotates daily
 * @returns Array of treasure positions with stable IDs
 */
export function generateTreasuresFromNodes(
  nodes: OsmNode[],
  dayNumber: number,
): Array<{ id: string; lat: number; lng: number }> {
  if (nodes.length === 0) return [];

  const seed = hashString(`osm-treasures:${dayNumber}`);
  const rng = mulberry32(seed);

  // Shuffle node indices deterministically
  const indices = Array.from({ length: nodes.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }

  const count = Math.min(
    Math.floor(nodes.length / NODES_PER_TREASURE),
    MAX_TREASURES_PER_REQUEST,
  );

  const results: Array<{ id: string; lat: number; lng: number }> = [];
  for (let i = 0; i < count; i++) {
    const nodeIndex = indices[i]!;
    const node = nodes[nodeIndex]!;
    results.push({
      id: `osm:${nodeIndex}:${dayNumber}`,
      lat: node.lat,
      lng: node.lng,
    });
  }
  return results;
}

/**
 * Fallback: generate treasures at random positions within a bounding box.
 * Used when Overpass returns no nodes (offline / sparse area).
 */
/**
 * Fallback: generate treasures at random positions within a bounding box.
 * Used when Overpass returns no nodes (offline / sparse area).
 * @param bbox - Bounding box to scatter treasures within (use a small radius ~300m)
 * @param dayNumber - Math.floor(Date.now() / 86400000) — rotates daily
 */
export function generateTreasuresFallback(
  bbox: BoundingBox,
  dayNumber: number,
): Array<{ id: string; lat: number; lng: number }> {
  const seed = hashString(`fallback:${bbox.minLat.toFixed(3)}:${bbox.minLng.toFixed(3)}:${dayNumber}`);
  const rng = mulberry32(seed);
  const count = 12 + Math.floor(rng() * 7); // 12–18 fallback treasures
  const results = [];
  for (let i = 0; i < count; i++) {
    const lat = bbox.minLat + rng() * (bbox.maxLat - bbox.minLat);
    const lng = bbox.minLng + rng() * (bbox.maxLng - bbox.minLng);
    results.push({ id: `fallback:${dayNumber}:${i}`, lat, lng });
  }
  return results;
}
