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

// Query Overpass API for building/walkway density in an area
// Returns density multiplier: buildings > 0.5/km² → 2x, parks/walkways → 0.5x, default 1x
export async function getOsmDensity(lat: number, lng: number): Promise<number> {
  const delta = 0.0005; // ~55m box
  const query = `[out:json][timeout:5];
(
  way["building"](${lat - delta},${lng - delta},${lat + delta},${lng + delta});
  way["highway"~"footway|path|pedestrian"](${lat - delta},${lng - delta},${lat + delta},${lng + delta});
  way["leisure"~"park|garden"](${lat - delta},${lng - delta},${lat + delta},${lng + delta});
);
out count;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { elements?: Array<{ tags?: { total?: number } }> };
    const total = data?.elements?.[0]?.tags?.total ?? 0;
    if (total >= 5) return 2; // dense buildings
    if (total === 0) return 0.5; // nothing → sparse
    return 1;
  } catch {
    return 1; // default on timeout
  }
}
