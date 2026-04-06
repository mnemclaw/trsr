import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32,
  hashString,
  getBoundingBox,
  generateTreasuresFromNodes,
  generateTreasuresFallback,
  getOsmWalkableNodes,
  type OsmNode,
} from './treasure-generator.js';

// ─── mulberry32 ───────────────────────────────────────────────────────────────

describe('mulberry32', () => {
  it('returns values in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 20; i++) {
      assert.equal(a(), b());
    }
  });

  it('differs for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const aVals = Array.from({ length: 10 }, () => a());
    const bVals = Array.from({ length: 10 }, () => b());
    // Very unlikely to be identical
    assert.notDeepEqual(aVals, bVals);
  });
});

// ─── hashString ───────────────────────────────────────────────────────────────

describe('hashString', () => {
  it('returns a non-negative integer', () => {
    assert.ok(hashString('hello') >= 0);
  });

  it('is deterministic', () => {
    assert.equal(hashString('test'), hashString('test'));
  });

  it('differs for different strings', () => {
    assert.notEqual(hashString('abc'), hashString('xyz'));
  });
});

// ─── getBoundingBox ───────────────────────────────────────────────────────────

describe('getBoundingBox', () => {
  it('produces a box ~1km around the center at 51°N', () => {
    const bbox = getBoundingBox(51.5, 0.1, 1000);
    // ~1km at equator ≈ 0.009 degrees lat
    assert.ok(bbox.maxLat - bbox.minLat > 0.015 && bbox.maxLat - bbox.minLat < 0.025);
    assert.ok(bbox.minLat < 51.5 && bbox.maxLat > 51.5);
    assert.ok(bbox.minLng < 0.1 && bbox.maxLng > 0.1);
  });

  it('center is within the bounding box', () => {
    const lat = 48.8566;
    const lng = 2.3522;
    const bbox = getBoundingBox(lat, lng, 500);
    assert.ok(bbox.minLat <= lat && lat <= bbox.maxLat);
    assert.ok(bbox.minLng <= lng && lng <= bbox.maxLng);
  });
});

// ─── generateTreasuresFromNodes ───────────────────────────────────────────────

describe('generateTreasuresFromNodes', () => {
  const sampleNodes: OsmNode[] = Array.from({ length: 100 }, (_, i) => ({
    lat: 51.5 + i * 0.0001,
    lng: 0.1 + i * 0.0001,
  }));

  it('returns empty array for empty nodes', () => {
    const result = generateTreasuresFromNodes([], 20000);
    assert.deepEqual(result, []);
  });

  it('generates ~1 treasure per 15 nodes', () => {
    const result = generateTreasuresFromNodes(sampleNodes, 20000);
    const expected = Math.floor(sampleNodes.length / 15);
    assert.equal(result.length, expected);
  });

  it('uses stable osm: IDs', () => {
    const result = generateTreasuresFromNodes(sampleNodes, 20000);
    for (const t of result) {
      assert.match(t.id, /^osm:\d+:20000$/);
    }
  });

  it('is deterministic across calls with same dayNumber', () => {
    const a = generateTreasuresFromNodes(sampleNodes, 20000);
    const b = generateTreasuresFromNodes(sampleNodes, 20000);
    assert.deepEqual(a, b);
  });

  it('differs across different dayNumbers', () => {
    const a = generateTreasuresFromNodes(sampleNodes, 20000);
    const b = generateTreasuresFromNodes(sampleNodes, 20001);
    // IDs encode dayNumber so they should differ
    assert.notDeepEqual(a, b);
  });

  it('all returned nodes come from the input array', () => {
    const result = generateTreasuresFromNodes(sampleNodes, 20000);
    for (const t of result) {
      const nodeIndex = parseInt(t.id.split(':')[1]!, 10);
      const node = sampleNodes[nodeIndex]!;
      assert.equal(t.lat, node.lat);
      assert.equal(t.lng, node.lng);
    }
  });

  it('caps at MAX_TREASURES_PER_REQUEST for large node arrays', () => {
    const bigNodes: OsmNode[] = Array.from({ length: 2000 }, (_, i) => ({
      lat: 51.5 + i * 0.00001,
      lng: 0.1 + i * 0.00001,
    }));
    const result = generateTreasuresFromNodes(bigNodes, 20000);
    assert.ok(result.length <= 50, `Expected ≤50 treasures, got ${result.length}`);
  });
});

// ─── generateTreasuresFallback ────────────────────────────────────────────────

describe('generateTreasuresFallback', () => {
  const bbox = { minLat: 51.49, maxLat: 51.51, minLng: 0.09, maxLng: 0.11 };

  it('returns 5–9 treasures', () => {
    const result = generateTreasuresFallback(bbox, 20000);
    assert.ok(result.length >= 5 && result.length <= 9, `Got ${result.length}`);
  });

  it('all positions are within the bbox', () => {
    const result = generateTreasuresFallback(bbox, 20000);
    for (const t of result) {
      assert.ok(t.lat >= bbox.minLat && t.lat <= bbox.maxLat, `lat ${t.lat} outside bbox`);
      assert.ok(t.lng >= bbox.minLng && t.lng <= bbox.maxLng, `lng ${t.lng} outside bbox`);
    }
  });

  it('is deterministic', () => {
    const a = generateTreasuresFallback(bbox, 20000);
    const b = generateTreasuresFallback(bbox, 20000);
    assert.deepEqual(a, b);
  });

  it('uses fallback: ID prefix with dayNumber', () => {
    const result = generateTreasuresFallback(bbox, 20000);
    for (const t of result) {
      assert.match(t.id, /^fallback:20000:\d+$/);
    }
  });
});

// ─── getOsmWalkableNodes (unit test with mocked fetch) ────────────────────────

describe('getOsmWalkableNodes', () => {
  it('returns empty array when Overpass is unavailable', async () => {
    // Temporarily override globalThis.fetch to simulate a network failure
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('Network error'); };
    try {
      // Use a unique bbox to avoid cache hit from other tests
      const bbox = { minLat: 10.001, maxLat: 10.999, minLng: 20.001, maxLng: 20.999 };
      const nodes = await getOsmWalkableNodes(bbox);
      assert.deepEqual(nodes, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses node elements from Overpass response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      json: async () => ({
        elements: [
          { type: 'node', lat: 51.5, lon: 0.1 },
          { type: 'node', lat: 51.501, lon: 0.101 },
          { type: 'way', lat: 51.502, lon: 0.102 }, // should be ignored
          { type: 'node', lat: 51.5, lon: 0.1 }, // duplicate — should be deduplicated
        ],
      }),
    }) as unknown as Promise<Response>;
    try {
      // Use unique bbox to avoid cache hit from other tests
      const bbox = { minLat: 30.001, maxLat: 30.999, minLng: 40.001, maxLng: 40.999 };
      const nodes = await getOsmWalkableNodes(bbox);
      // 3 nodes in input, 1 is a way (ignored), 1 is near-duplicate → 2 unique nodes
      assert.equal(nodes.length, 2);
      assert.equal(nodes[0]!.lat, 51.5);
      assert.equal(nodes[0]!.lng, 0.1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
