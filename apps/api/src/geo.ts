/**
 * geo.ts — OSM/Overpass building-check utilities
 *
 * isInsideBuilding queries the Overpass API for building polygons near the given
 * coordinates and performs a ray-casting point-in-polygon test.
 *
 * Fail-open contract: any network error or timeout returns false so that a
 * transient Overpass outage never blocks a legitimate drop.
 */

interface OverpassNode {
  lat: number;
  lon: number;
}

interface OverpassElement {
  type: string;
  geometry?: OverpassNode[];
  members?: Array<{ geometry?: OverpassNode[] }>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Ray-casting point-in-polygon check.
 * polygon points use { lat, lon } as returned by the Overpass API.
 */
function pointInPolygon(
  lat: number,
  lng: number,
  polygon: Array<{ lat: number; lon: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon;
    const yi = polygon[i].lat;
    const xj = polygon[j].lon;
    const yj = polygon[j].lat;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Returns true if the given coordinates fall inside a building polygon
 * according to OpenStreetMap data via the Overpass API.
 *
 * Fails open (returns false) on any network error, timeout, or parse failure.
 */
export async function isInsideBuilding(lat: number, lng: number): Promise<boolean> {
  const query = `[out:json][timeout:5];
(
  way["building"](around:5,${lat},${lng});
  relation["building"]["type"="multipolygon"](around:5,${lat},${lng});
);
out geom;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as OverpassResponse;

    if (!Array.isArray(data.elements) || data.elements.length === 0) {
      return false;
    }

    for (const element of data.elements) {
      if (element.type === 'way' && Array.isArray(element.geometry) && element.geometry.length >= 3) {
        if (pointInPolygon(lat, lng, element.geometry)) {
          return true;
        }
      }

      // relation members may carry outer ring geometry
      if (element.type === 'relation' && Array.isArray(element.members)) {
        for (const member of element.members) {
          if (Array.isArray(member.geometry) && member.geometry.length >= 3) {
            if (pointInPolygon(lat, lng, member.geometry)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  } catch {
    // Timeout, network error, JSON parse failure — fail open
    return false;
  } finally {
    clearTimeout(timer);
  }
}
