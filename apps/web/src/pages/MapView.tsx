import { useState, useEffect } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { MapContainer, TileLayer } from 'react-leaflet';

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

  return (
    <MapContainer
      center={[position.lat, position.lng]}
      zoom={15}
      className="h-screen w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
    </MapContainer>
  );
}
