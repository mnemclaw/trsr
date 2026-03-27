import { CircleMarker } from 'react-leaflet';
import { dropAgeState, DROP_AGE_COLOURS } from '@trsr/types';
import { useDropsStore } from '../store/drops.js';

export function DropMarkers() {
  const drops = useDropsStore((s) => s.drops);
  const selectedDropId = useDropsStore((s) => s.selectedDropId);
  const setSelectedDropId = useDropsStore((s) => s.setSelectedDropId);

  return (
    <>
      {Object.values(drops).map((drop) => {
        const age = dropAgeState(drop.createdAt);
        const isSelected = drop.id === selectedDropId;
        const color = isSelected ? '#5CF401' : DROP_AGE_COLOURS[age];
        const fillOpacity = age === 'stale' ? 0.4 : 0.8;
        const netVotes = drop.upvotes - drop.downvotes;
        const radius = 8 + Math.min(netVotes, 10) * 0.5;

        return (
          <CircleMarker
            key={drop.id}
            center={[drop.lat, drop.lng]}
            radius={radius}
            pathOptions={{ color, fillColor: color, fillOpacity }}
            eventHandlers={{ click: () => setSelectedDropId(drop.id) }}
          />
        );
      })}
    </>
  );
}
