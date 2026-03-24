import { CircleMarker } from 'react-leaflet';
import { dropAgeState, DROP_AGE_COLOURS } from '@trsr/types';
import { useDropsStore } from '../store/drops.js';

export function DropMarkers() {
  const drops = useDropsStore((s) => s.drops);
  const setSelectedDropId = useDropsStore((s) => s.setSelectedDropId);

  return (
    <>
      {Object.values(drops).map((drop) => {
        const age = dropAgeState(drop.expiresAt);
        const color = DROP_AGE_COLOURS[age];
        const netVotes = drop.upvotes - drop.downvotes;
        const radius = 8 + Math.min(netVotes, 10) * 0.5;

        return (
          <CircleMarker
            key={drop.id}
            center={[drop.lat, drop.lng]}
            radius={radius}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.8 }}
            eventHandlers={{ click: () => setSelectedDropId(drop.id) }}
          />
        );
      })}
    </>
  );
}
