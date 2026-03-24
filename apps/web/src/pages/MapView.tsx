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

function MapWithDrops({ position }: { position: Position }) {
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <DropMarkers />
        <MapEffects onMapReady={handleMapReady} />
      </MapContainer>
      <DropCard />
      <CreateDropButton getMapCenter={getMapCenter} />
    </>
  );
}

export default function MapView() {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setError('Location access denied. Enable location permissions to use trsr.');
      },
    );
  }, []);

  if (error) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-900 text-white">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!position) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-900 text-white">
        <p className="text-slate-400">Loading location…</p>
      </div>
    );
  }

  return <MapWithDrops position={position} />;
}
