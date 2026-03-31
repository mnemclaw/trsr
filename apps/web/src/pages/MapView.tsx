import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DropCard } from '../components/DropCard.js';
import { CreateDropButton } from '../components/CreateDropButton.js';
import { useDropSocket } from '../hooks/useDropSocket.js';
import { useTreasureLayer } from '../hooks/useTreasureLayer.js';
import { useDropsStore } from '../store/drops.js';
import { fetchDropsInBbox } from '../api/drops.js';
import { dropAgeState, DROP_AGE_COLOURS } from '@trsr/types';
import type { Drop } from '@trsr/types';

// ---------------------------------------------------------------------------
// Tile style — CartoDB Voyager raster tiles
// ---------------------------------------------------------------------------
const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'carto-voyager': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'carto-voyager', type: 'raster', source: 'carto-voyager' }],
};

// ---------------------------------------------------------------------------
// Default fallback centre — Paris
// ---------------------------------------------------------------------------
const DEFAULT_LNG = 2.3522;
const DEFAULT_LAT = 48.8566;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function markerColor(drop: Drop, selectedDropId: string | null): string {
  if (drop.id === selectedDropId) return '#5CF401';
  const age = dropAgeState(drop.createdAt);
  return DROP_AGE_COLOURS[age];
}

function markerOpacity(drop: Drop): number {
  return dropAgeState(drop.createdAt) === 'stale' ? 0.4 : 0.8;
}

function markerRadius(drop: Drop): number {
  const netVotes = drop.upvotes - drop.downvotes;
  return 8 + Math.min(netVotes, 10) * 0.5;
}

// ---------------------------------------------------------------------------
// Cone GeoJSON builder
// ---------------------------------------------------------------------------
function buildConeGeoJSON(lat: number, lng: number, headingDeg: number, reachM = 15, halfAngleDeg = 30) {
  // Convert reach from metres to degrees (approximate)
  const reachLat = reachM / 111000;
  const reachLng = reachM / (111000 * Math.cos((lat * Math.PI) / 180));

  const steps = 12;
  const coords: [number, number][] = [[lng, lat]]; // start at player
  for (let i = -halfAngleDeg; i <= halfAngleDeg; i += (halfAngleDeg * 2) / steps) {
    const angleDeg = headingDeg + i;
    const bearingRad = (angleDeg * Math.PI) / 180;
    const dLat = reachLat * Math.cos(bearingRad);
    const dLng = reachLng * Math.sin(bearingRad);
    coords.push([lng + dLng, lat + dLat]);
  }
  coords.push([lng, lat]); // close polygon
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [coords] },
    properties: {},
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function MapView() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const coneMapRef = useRef<maplibregl.Map | null>(null);
  const lastOrientationTimeRef = useRef<number>(0);

  // Drop markers: id → Marker
  const dropMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  // User location marker
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Compass heading from DeviceOrientationEvent (degrees, clockwise from north)
  const compassHeadingRef = useRef<number | null>(null);
  // Player position refs for use in orientation handler
  const playerLatRef = useRef<number | null>(null);
  const playerLngRef = useRef<number | null>(null);

  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [compassGranted, setCompassGranted] = useState(false);
  const [showCompassButton, setShowCompassButton] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);

  // Store
  const drops = useDropsStore((s) => s.drops);
  const selectedDropId = useDropsStore((s) => s.selectedDropId);
  const setSelectedDropId = useDropsStore((s) => s.setSelectedDropId);
  const upsertDrop = useDropsStore((s) => s.upsertDrop);
  const removeDrop = useDropsStore((s) => s.removeDrop);

  // Socket (handles drop:created / drop:updated / drop:expired)
  useDropSocket();

  // Treasure layer
  const { balance, refreshBalance, checkConeCollect } = useTreasureLayer({
    lat: userLat,
    lng: userLng,
    heading: compassHeadingRef.current,
    map: mapInstance,
  });

  // ---------------------------------------------------------------------------
  // Cone update helper
  // ---------------------------------------------------------------------------
  const updateCone = useCallback((lat: number, lng: number, heading: number) => {
    const src = coneMapRef.current?.getSource('player-cone') as maplibregl.GeoJSONSource | undefined;
    src?.setData(buildConeGeoJSON(lat, lng, heading));
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch drops for current map bounds
  // ---------------------------------------------------------------------------
  const fetchDrops = useCallback(async (map: maplibregl.Map) => {
    const bounds = map.getBounds();
    try {
      const result = await fetchDropsInBbox({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
      });
      for (const d of result) upsertDrop(d);
    } catch {
      // silently ignore fetch errors
    }
  }, [upsertDrop]);

  // ---------------------------------------------------------------------------
  // Compass handler
  // ---------------------------------------------------------------------------
  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    const now = Date.now();
    if (now - lastOrientationTimeRef.current < 100) return; // 10Hz max
    lastOrientationTimeRef.current = now;

    const map = mapRef.current;
    // On iOS, webkitCompassHeading gives a true magnetic bearing (0–360, clockwise
    // from north) that works even when stationary.  On Android/other, alpha is
    // counterclockwise so we invert it.
    const webkitHeading = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
    let heading: number;
    if (typeof webkitHeading === 'number') {
      // iOS true compass heading — use directly
      heading = webkitHeading;
    } else {
      if (e.alpha === null) return;
      // Non-iOS: alpha is counterclockwise from arbitrary zero, invert to clockwise
      heading = 360 - e.alpha;
    }
    compassHeadingRef.current = heading;
    if (map) {
      map.setBearing(heading);
    }

    // Update cone and check auto-collect when compass updates
    const lat = playerLatRef.current;
    const lng = playerLngRef.current;
    if (lat !== null && lng !== null) {
      updateCone(lat, lng, heading);
      checkConeCollect(lat, lng, heading);
    }
  }, [updateCone, checkConeCollect]);

  const attachCompassListeners = useCallback(() => {
    window.addEventListener('deviceorientationabsolute', handleOrientation as EventListener, true);
    // Fallback for browsers that only fire 'deviceorientation'
    window.addEventListener('deviceorientation', handleOrientation as EventListener, true);
    setCompassGranted(true);
    setShowCompassButton(false);
  }, [handleOrientation]);

  const requestCompassPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const perm = await DOE.requestPermission();
        if (perm === 'granted') {
          attachCompassListeners();
        }
      } catch {
        // permission denied — compass unavailable
      }
    } else {
      attachCompassListeners();
    }
  }, [attachCompassListeners]);

  // ---------------------------------------------------------------------------
  // Initialise map
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: RASTER_STYLE,
      center: [DEFAULT_LNG, DEFAULT_LAT],
      zoom: 17,
      pitch: 50,
      bearing: 0,
      interactive: false,       // all pan/zoom/rotate disabled — navigation only
      attributionControl: false,
    });

    mapRef.current = map;
    coneMapRef.current = map;

    map.on('load', () => {
      // Add cone source and layers
      map.addSource('player-cone', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
      });
      map.addLayer({
        id: 'player-cone',
        type: 'fill',
        source: 'player-cone',
        paint: {
          'fill-color': '#4A90E2',
          'fill-opacity': 0.2,
        },
      });
      map.addLayer({
        id: 'player-cone-outline',
        type: 'line',
        source: 'player-cone',
        paint: {
          'line-color': '#4A90E2',
          'line-opacity': 0.5,
          'line-width': 1,
        },
      });

      setMapInstance(map);
      void fetchDrops(map);
    });

    map.on('moveend', () => {
      void fetchDrops(map);
    });

    // Create user location marker (static dot — heading shown via map bearing)
    const userEl = document.createElement('div');
    userEl.className = 'user-location-wrapper';
    userEl.innerHTML = `
      <div class="user-location-pulse"></div>
      <div class="user-location-dot"></div>
    `;
    const userMarker = new maplibregl.Marker({ element: userEl, anchor: 'center' })
      .setLngLat([DEFAULT_LNG, DEFAULT_LAT])
      .addTo(map);
    userMarkerRef.current = userMarker;

    // GPS tracking
    if (!navigator.geolocation) {
      setLocationWarning('Geolocation not supported — showing default map centre.');
    } else {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          // Prefer DeviceOrientation compass heading; fall back to GPS travel heading
          const heading = compassHeadingRef.current ?? pos.coords.heading ?? undefined;
          map.jumpTo({ center: [lng, lat], ...(heading !== undefined && !compassGranted ? { bearing: heading } : {}) });
          userMarkerRef.current?.setLngLat([lng, lat]);
          setUserLat(lat);
          setUserLng(lng);

          // Update player position refs
          playerLatRef.current = lat;
          playerLngRef.current = lng;

          // Update cone and check auto-collect on GPS update
          const currentHeading = compassHeadingRef.current;
          if (currentHeading !== null) {
            updateCone(lat, lng, currentHeading);
            checkConeCollect(lat, lng, currentHeading);
          }

          // Show compass button on first GPS fix (iOS needs user gesture)
          if (!compassGranted) {
            const DOE = DeviceOrientationEvent as unknown as {
              requestPermission?: () => Promise<string>;
            };
            if (typeof DOE.requestPermission === 'function') {
              setShowCompassButton(true);
            } else {
              // Non-iOS: attach immediately
              attachCompassListeners();
            }
          }
        },
        () => {
          setLocationWarning('Location access denied — map showing default centre.');
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
        window.removeEventListener('deviceorientationabsolute', handleOrientation as EventListener, true);
        window.removeEventListener('deviceorientation', handleOrientation as EventListener, true);
        map.remove();
        mapRef.current = null;
        coneMapRef.current = null;
      };
    }

    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation as EventListener, true);
      window.removeEventListener('deviceorientation', handleOrientation as EventListener, true);
      map.remove();
      mapRef.current = null;
      coneMapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Sync drop markers whenever the store updates
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(Object.keys(drops));
    const existingIds = dropMarkersRef.current;

    // Remove expired markers
    for (const [id, marker] of existingIds.entries()) {
      if (!currentIds.has(id)) {
        marker.remove();
        existingIds.delete(id);
      }
    }

    // Add or update markers
    for (const drop of Object.values(drops)) {
      const color = markerColor(drop, selectedDropId);
      const opacity = markerOpacity(drop);
      const radius = markerRadius(drop);

      const existing = existingIds.get(drop.id);
      if (existing) {
        // Update element style in place
        const el = existing.getElement();
        el.style.background = color;
        el.style.opacity = String(opacity);
        const size = `${radius * 2}px`;
        el.style.width = size;
        el.style.height = size;
        el.style.marginLeft = `-${radius}px`;
        el.style.marginTop = `-${radius}px`;
        existing.setLngLat([drop.lng, drop.lat]);
      } else {
        const el = document.createElement('div');
        el.className = 'drop-marker';
        el.style.cssText = [
          `width:${radius * 2}px`,
          `height:${radius * 2}px`,
          `margin-left:-${radius}px`,
          `margin-top:-${radius}px`,
          'border-radius:50%',
          `background:${color}`,
          'border:2px solid white',
          `opacity:${opacity}`,
          'cursor:pointer',
          'box-shadow:0 2px 6px rgba(0,0,0,0.35)',
        ].join(';');

        el.addEventListener('click', () => {
          setSelectedDropId(drop.id);
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([drop.lng, drop.lat])
          .addTo(map);

        existingIds.set(drop.id, marker);
      }
    }
  }, [drops, selectedDropId, setSelectedDropId]);

  // Expose removeDrop to silence the linter (socket hook calls it via store)
  void removeDrop;

  // ---------------------------------------------------------------------------
  // getMapCenter for CreateDropButton (user's GPS position = map centre)
  // ---------------------------------------------------------------------------
  const getMapCenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Map canvas */}
      <div ref={mapContainerRef} style={{ position: 'fixed', inset: 0, zIndex: 0 }} />

      {/* Warnings */}
      {locationWarning && (
        <div
          style={{
            position: 'fixed',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 3000,
            background: 'var(--color-cream)',
            color: '#1a1a1a',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '13px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {locationWarning}
        </div>
      )}

      {/* iOS compass permission button — auto-hides after grant */}
      {showCompassButton && !compassGranted && (
        <button
          onClick={() => void requestCompassPermission()}
          style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            zIndex: 3000,
            background: 'var(--color-cream)',
            color: '#1a1a1a',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '13px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          Enable compass
        </button>
      )}

      {/* Drop card overlay */}
      <DropCard />

      {/* Treasure balance badge */}
      <div
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 2000,
          background: 'var(--color-cream)',
          color: '#1a1a1a',
          borderRadius: '20px',
          padding: '6px 14px',
          fontSize: '14px',
          fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          pointerEvents: 'none',
          letterSpacing: '0.02em',
        }}
      >
        † {balance}/10
      </div>

      {/* Create drop button */}
      <CreateDropButton
        getMapCenter={getMapCenter}
        balance={balance}
        refreshBalance={refreshBalance}
      />
    </>
  );
}
