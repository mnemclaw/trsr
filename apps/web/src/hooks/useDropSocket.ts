import { useEffect } from 'react';
import { io } from 'socket.io-client';
import type { Drop } from '@trsr/types';
import { useDropsStore } from '../store/drops.js';

export function useDropSocket(): void {
  const upsertDrop = useDropsStore((s) => s.upsertDrop);
  const removeDrop = useDropsStore((s) => s.removeDrop);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? '';
    const socket = io(apiUrl || window.location.origin);

    socket.on('drop:created', (drop: Drop) => upsertDrop(drop));
    socket.on('drop:updated', (drop: Drop) => upsertDrop(drop));
    socket.on('drop:expired', ({ id }: { id: string }) => removeDrop(id));

    return () => {
      socket.disconnect();
    };
  }, [upsertDrop, removeDrop]);
}
