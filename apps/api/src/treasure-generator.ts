// Deterministic PRNG — mulberry32
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// Generate treasure positions for a given lat/lng tile and day
// tile = 0.001 degree grid (~111m per tile at equator)
export function generateTreasuresForTile(
  tileLat: number, // floor(lat / 0.001)
  tileLng: number, // floor(lng / 0.001)
  dayNumber: number, // Math.floor(Date.now() / 86400000)
  density: number = 1, // 1 = normal, 2 = double (buildings), 0.5 = parks/walkways
): Array<{ id: string; lat: number; lng: number }> {
  const tileKey = `${tileLat}:${tileLng}`;
  const seed = hashString(`${tileKey}:${dayNumber}`);
  const rng = mulberry32(seed);

  // Base count: density * ~3 per tile on average
  const count = Math.floor(rng() * density * 4) + Math.floor(density);

  const results = [];
  for (let i = 0; i < count; i++) {
    const lat = (tileLat + rng()) * 0.001;
    const lng = (tileLng + rng()) * 0.001;
    const id = `${tileKey}:${dayNumber}:${i}`;
    results.push({ id, lat, lng });
  }
  return results;
}

// Get all tiles within radius meters of a center point
export function getTilesInRadius(
  centerLat: number,
  centerLng: number,
  radiusMeters = 1000,
): Array<[number, number]> {
  const latDelta = radiusMeters / 111000;
  const lngDelta = radiusMeters / (111000 * Math.cos((centerLat * Math.PI) / 180));
  const tileSize = 0.001;

  const tiles: Array<[number, number]> = [];
  for (let lat = centerLat - latDelta; lat <= centerLat + latDelta; lat += tileSize) {
    for (let lng = centerLng - lngDelta; lng <= centerLng + lngDelta; lng += tileSize) {
      // Only include tiles within actual radius
      const dLat = lat - centerLat;
      const dLng = (lng - centerLng) * Math.cos((centerLat * Math.PI) / 180);
      if (Math.sqrt(dLat * dLat + dLng * dLng) * 111000 <= radiusMeters) {
        tiles.push([Math.floor(lat / tileSize), Math.floor(lng / tileSize)]);
      }
    }
  }
  return tiles;
}

// In-memory density cache: tile key → { density, expiresAt }
const densityCache = new Map<string, { density: number; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Query Overpass API for building/walkway density across an entire area in one request.
// Called once per /api/treasures request (not per tile).
// Returns a map of tileKey → density multiplier.
export async function getOsmDensityMap(
  tiles: Array<[number, number]>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const now = Date.now();

  // Separate cached vs uncached tiles
  const uncached: Array<[number, number]> = [];
  for (const [tileLat, tileLng] of tiles) {
    const key = `${tileLat}:${tileLng}`;
    const cached = densityCache.get(key);
    if (cached && cached.expiresAt > now) {
      result.set(key, cached.density);
    } else {
      uncached.push([tileLat, tileLng]);
    }
  }

  if (uncached.length === 0) return result;

  // Compute bounding box covering all uncached tiles
  const lats = uncached.map(([lat]) => lat * 0.001);
  const lngs = uncached.map(([, lng]) => lng * 0.001);
  const minLat = Math.min(...lats) - 0.001;
  const maxLat = Math.max(...lats) + 0.002;
  const minLng = Math.min(...lngs) - 0.001;
  const maxLng = Math.max(...lngs) + 0.002;

  const query = `[out:json][timeout:10];
(
  way["building"](${minLat},${minLng},${maxLat},${maxLng});
  way["highway"~"footway|path|pedestrian"](${minLat},${minLng},${maxLat},${maxLng});
  way["leisure"~"park|garden"](${minLat},${minLng},${maxLat},${maxLng});
);
out center;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as {
      elements?: Array<{ type: string; center?: { lat: number; lon: number }; tags?: Record<string, string> }>;
    };

    // Count features per tile
    const tileCounts = new Map<string, { buildings: number; green: number }>();
    for (const el of data.elements ?? []) {
      const center = el.center;
      if (!center) continue;
      const tLat = Math.floor(center.lat / 0.001);
      const tLng = Math.floor(center.lon / 0.001);
      const key = `${tLat}:${tLng}`;
      const entry = tileCounts.get(key) ?? { buildings: 0, green: 0 };
      if (el.tags?.building) entry.buildings++;
      if (el.tags?.leisure || el.tags?.highway) entry.green++;
      tileCounts.set(key, entry);
    }

    for (const [tileLat, tileLng] of uncached) {
      const key = `${tileLat}:${tileLng}`;
      const counts = tileCounts.get(key) ?? { buildings: 0, green: 0 };
      let density = 1;
      if (counts.buildings >= 3) density = 2;
      else if (counts.green >= 2) density = 0.5;
      densityCache.set(key, { density, expiresAt: now + CACHE_TTL_MS });
      result.set(key, density);
    }
  } catch {
    // Overpass unavailable — use uniform density for all uncached tiles
    for (const [tileLat, tileLng] of uncached) {
      const key = `${tileLat}:${tileLng}`;
      densityCache.set(key, { density: 1, expiresAt: now + CACHE_TTL_MS });
      result.set(key, 1);
    }
  }

  return result;
}
