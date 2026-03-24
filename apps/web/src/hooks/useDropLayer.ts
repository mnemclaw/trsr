import { useEffect } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { fetchDropsInBbox } from '../api/drops.js';
import { useDropsStore } from '../store/drops.js';

export function useDropLayer(map: LeafletMap | null): void {
  const setDrops = useDropsStore((s) => s.setDrops);
  const upsertDrop = useDropsStore((s) => s.upsertDrop);

  useEffect(() => {
    if (!map) return;

    async function loadDrops(): Promise<void> {
      if (!map) return;
      const bounds = map.getBounds();
      const bbox = {
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
      };
      try {
        const drops = await fetchDropsInBbox(bbox);
        for (const d of drops) upsertDrop(d);
      } catch {
        // silently ignore fetch errors
      }
    }

    // Initial load
    void loadDrops();

    map.on('moveend', loadDrops);
    map.on('zoomend', loadDrops);

    return () => {
      map.off('moveend', loadDrops);
      map.off('zoomend', loadDrops);
    };
  }, [map, setDrops, upsertDrop]);
}
