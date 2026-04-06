import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { fetchTreasures, collectTreasure, fetchPlayerBalance } from '../api/treasures.js';

const REFETCH_DISTANCE_M = 150; // only re-fetch when user moves >150m
const REFETCH_INTERVAL_MS = 60_000;
const BBOX_DEG = 0.0006; // ~66m bounding-box pre-filter for cone collect

function getAnonymousUserId(): string {
  const key = 'trsr:uid';
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(key, uid);
  }
  return uid;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111000;
  const dLng = (lng2 - lng1) * 111000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function bearingTo(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const dLng = (toLng - fromLng) * Math.cos((fromLat * Math.PI) / 180);
  const dLat = toLat - fromLat;
  return (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
}

function isInCone(
  playerLat: number, playerLng: number,
  heading: number,
  treasureLat: number, treasureLng: number,
  reachM = 20, halfAngleDeg = 30
): boolean {
  const dist = distanceMeters(playerLat, playerLng, treasureLat, treasureLng);
  if (dist > reachM) return false;
  const bearing = bearingTo(playerLat, playerLng, treasureLat, treasureLng);
  const diff = ((bearing - heading + 540) % 360) - 180;
  return Math.abs(diff) <= halfAngleDeg;
}

interface UseTreasureLayerOptions {
  lat: number | null;
  lng: number | null;
  heading: number | null;
  map: maplibregl.Map | null;
}

interface UseTreasureLayerResult {
  balance: number;
  refreshBalance: () => Promise<void>;
  checkConeCollect: (playerLat: number, playerLng: number, heading: number) => void;
}

export function useTreasureLayer({
  lat,
  lng,
  heading,
  map,
}: UseTreasureLayerOptions): UseTreasureLayerResult {
  const [balance, setBalance] = useState<number>(0);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const tokenDataRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const playerIdRef = useRef<string>(getAnonymousUserId());
  const lastFetchPosRef = useRef<{ lat: number; lng: number } | null>(null);
  // Keep latest lat/lng in a ref so the interval reads current values without re-creating
  const posRef = useRef<{ lat: number | null; lng: number | null }>({ lat, lng });
  posRef.current = { lat, lng };

  // Silence unused heading warning — heading is used by checkConeCollect caller
  void heading;

  const refreshBalance = useCallback(async () => {
    try {
      const b = await fetchPlayerBalance(playerIdRef.current);
      setBalance(b);
    } catch {
      // silently ignore
    }
  }, []);

  const checkConeCollect = useCallback(
    (playerLat: number, playerLng: number, playerHeading: number) => {
      for (const [id, data] of tokenDataRef.current.entries()) {
        // Fast bounding box pre-filter
        if (Math.abs(data.lat - playerLat) > BBOX_DEG || Math.abs(data.lng - playerLng) > BBOX_DEG) continue;
        // Full cone check only for nearby tokens
        if (isInCone(playerLat, playerLng, playerHeading, data.lat, data.lng)) {
          // Remove from map immediately (optimistic)
          const marker = markersRef.current.get(id);
          if (marker) {
            marker.remove();
            markersRef.current.delete(id);
            tokenDataRef.current.delete(id);
          }
          // Collect on server
          collectTreasure(id, playerIdRef.current, playerLat, playerLng, Math.floor(Date.now() / 86400000))
            .then((result) => setBalance(result.balance))
            .catch(() => { /* already collected — ignore */ });
        }
      }
    },
    [],
  );

  const loadTreasures = useCallback(
    async (centerLat: number, centerLng: number, currentMap: maplibregl.Map) => {
      try {
        const tokens = await fetchTreasures(centerLat, centerLng);
        const incomingIds = new Set(tokens.map((t) => t.id));

        // Remove stale markers
        for (const [id, marker] of markersRef.current.entries()) {
          if (!incomingIds.has(id)) {
            marker.remove();
            markersRef.current.delete(id);
            tokenDataRef.current.delete(id);
          }
        }

        // Add new markers
        for (const token of tokens) {
          if (markersRef.current.has(token.id)) continue;

          tokenDataRef.current.set(token.id, { lat: token.lat, lng: token.lng });

          const el = document.createElement('div');
          el.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;pointer-events:none;';

          const inner = document.createElement('div');
          inner.className = 'treasure-marker';
          inner.textContent = '†';
          el.appendChild(inner);

          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([token.lng, token.lat])
            .addTo(currentMap);

          markersRef.current.set(token.id, marker);
        }
      } catch {
        // silently ignore fetch errors
      }
    },
    [],
  );

  // Initial balance fetch
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  // Main fetch loop — only depends on `map`, never restarts due to GPS updates
  useEffect(() => {
    if (!map) return;

    const maybeLoad = () => {
      const { lat: curLat, lng: curLng } = posRef.current;
      if (curLat === null || curLng === null) return;
      lastFetchPosRef.current = { lat: curLat, lng: curLng };
      void loadTreasures(curLat, curLng, map);
    };

    maybeLoad();
    const interval = setInterval(maybeLoad, REFETCH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      for (const marker of markersRef.current.values()) {
        marker.remove();
      }
      markersRef.current.clear();
      tokenDataRef.current.clear();
    };
  }, [map, loadTreasures]);

  // Re-fetch only when user moves >150m — does NOT restart the interval
  useEffect(() => {
    if (!map || lat === null || lng === null) return;
    const last = lastFetchPosRef.current;
    if (!last || distanceMeters(last.lat, last.lng, lat, lng) > REFETCH_DISTANCE_M) {
      lastFetchPosRef.current = { lat, lng };
      void loadTreasures(lat, lng, map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return { balance, refreshBalance, checkConeCollect };
}
