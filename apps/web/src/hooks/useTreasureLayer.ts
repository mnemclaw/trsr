import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { fetchTreasures, collectTreasure, fetchPlayerBalance } from '../api/treasures.js';

function getAnonymousUserId(): string {
  const key = 'trsr:uid';
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(key, uid);
  }
  return uid;
}

interface UseTreasureLayerOptions {
  lat: number | null;
  lng: number | null;
  map: maplibregl.Map | null;
}

interface UseTreasureLayerResult {
  balance: number;
  refreshBalance: () => Promise<void>;
}

export function useTreasureLayer({
  lat,
  lng,
  map,
}: UseTreasureLayerOptions): UseTreasureLayerResult {
  const [balance, setBalance] = useState<number>(0);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const playerId = getAnonymousUserId();

  const refreshBalance = useCallback(async () => {
    try {
      const b = await fetchPlayerBalance(playerId);
      setBalance(b);
    } catch {
      // silently ignore
    }
  }, [playerId]);

  const loadTreasures = useCallback(
    async (centerLat: number, centerLng: number, currentMap: maplibregl.Map) => {
      try {
        const tokens = await fetchTreasures(centerLat, centerLng);
        const incomingIds = new Set(tokens.map((t) => t.id));

        // Remove markers no longer in the response
        for (const [id, marker] of markersRef.current.entries()) {
          if (!incomingIds.has(id)) {
            marker.remove();
            markersRef.current.delete(id);
          }
        }

        // Add new markers
        for (const token of tokens) {
          if (markersRef.current.has(token.id)) continue;

          const el = document.createElement('div');
          el.className = 'treasure-marker';
          el.textContent = '†';

          el.addEventListener('click', async () => {
            // Collect-flash animation
            el.classList.add('treasure-collect-flash');
            try {
              const result = await collectTreasure(token.id, playerId);
              setBalance(result.balance);
            } catch {
              // already collected or error — remove marker anyway
            }
            // Remove marker after animation
            setTimeout(() => {
              const m = markersRef.current.get(token.id);
              if (m) {
                m.remove();
                markersRef.current.delete(token.id);
              }
            }, 300);
          });

          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([token.lng, token.lat])
            .addTo(currentMap);

          markersRef.current.set(token.id, marker);
        }
      } catch {
        // silently ignore fetch errors
      }
    },
    [playerId],
  );

  // Initial balance fetch
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  // Load treasures on mount and every 60 seconds when position is available
  useEffect(() => {
    if (!map || lat === null || lng === null) return;

    void loadTreasures(lat, lng, map);
    const interval = setInterval(() => {
      void loadTreasures(lat, lng, map);
    }, 60_000);

    return () => {
      clearInterval(interval);
      // Clean up all treasure markers on unmount
      for (const marker of markersRef.current.values()) {
        marker.remove();
      }
      markersRef.current.clear();
    };
  }, [map, lat, lng, loadTreasures]);

  return { balance, refreshBalance };
}
