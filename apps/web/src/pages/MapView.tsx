import { useState, useEffect, useRef, useCallback } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { DropMarkers } from '../components/DropMarkers.js';
import { DropCard } from '../components/DropCard.js';
import { CreateDropButton } from '../components/CreateDropButton.js';
import { useDropSocket } from '../hooks/useDropSocket.js';
import { useDropLayer } from '../hooks/useDropLayer.js';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface Position {
  lat: number;
  lng: number;
}

interface UserPosition extends Position {
  heading: number | null;
}

function createUserLocationIcon(heading: number | null): L.DivIcon {
  const hasHeading = heading !== null && !isNaN(heading);
  const arrowHtml = hasHeading
    ? `<div class="user-location-arrow" style="transform: rotate(${heading}deg)"></div>`
    : '';

  return L.divIcon({
    className: '',
    html: `
      <div class="user-location-wrapper">
        <div class="user-location-pulse"></div>
        <div class="user-location-dot"></div>
        ${arrowHtml}
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function UserLocationMarker({ position }: { position: UserPosition }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const icon = createUserLocationIcon(position.heading);
    if (!markerRef.current) {
      markerRef.current = L.marker([position.lat, position.lng], {
        icon,
        zIndexOffset: 1000,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng([position.lat, position.lng]);
      markerRef.current.setIcon(icon);
    }
    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!markerRef.current) return;
    markerRef.current.setLatLng([position.lat, position.lng]);
    markerRef.current.setIcon(createUserLocationIcon(position.heading));
  }, [position]);

  return null;
}

// Inner component that has access to the map instance via hook
function MapEffects({
  onMapReady,
}: {
  onMapReady: (map: LeafletMap) => void;
}) {
  const map = useMap();

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  return null;
}

function MapWithDrops({
  position,
  userPosition,
}: {
  position: Position;
  userPosition: UserPosition | null;
}) {
  const [map, setMap] = useState<LeafletMap | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  const handleMapReady = useCallback((m: LeafletMap) => {
    mapRef.current = m;
    setMap(m);
  }, []);

  useDropSocket();
  useDropLayer(map);

  const getMapCenter = useCallback(() => {
    if (mapRef.current) {
      const center = mapRef.current.getCenter();
      return { lat: center.lat, lng: center.lng };
    }
    return { lat: position.lat, lng: position.lng };
  }, [position]);

  return (
    <>
      <MapContainer
        center={[position.lat, position.lng]}
        zoom={15}
        className="h-screen w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <DropMarkers />
        <MapEffects onMapReady={handleMapReady} />
        {userPosition && <UserLocationMarker position={userPosition} />}
      </MapContainer>
      <DropCard />
      <CreateDropButton getMapCenter={getMapCenter} />
    </>
  );
}

// Default fallback centre — world view
const DEFAULT_POSITION: Position = { lat: 48.8566, lng: 2.3522 };

export default function MapView() {
  const [position, setPosition] = useState<Position | null>(null);
  const [userPosition, setUserPosition] = useState<UserPosition | null>(null);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationWarning('Geolocation not supported — showing default map centre.');
      setPosition(DEFAULT_POSITION);
      return;
    }

    // Get initial position to set map centre immediately
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPosition(p);
        setUserPosition({ ...p, heading: pos.coords.heading });
      },
      () => {
        setLocationWarning('Location access denied — pan the map to your location to drop.');
        setPosition(DEFAULT_POSITION);
      },
    );

    // Watch for real-time position and heading updates
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
        };
        setUserPosition(p);
        setPosition((prev) => prev ?? { lat: p.lat, lng: p.lng });
      },
      () => {
        // Non-fatal — map stays centred on last known position
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  if (!position) {
    return (
      <div className="h-screen w-full flex items-center justify-center" style={{ background: 'var(--color-cream)' }}>
        <p style={{ color: '#888' }}>Loading…</p>
      </div>
    );
  }

  return (
    <>
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
          }}
        >
          {locationWarning}
        </div>
      )}
      <MapWithDrops position={position} userPosition={userPosition} />
    </>
  );
}
