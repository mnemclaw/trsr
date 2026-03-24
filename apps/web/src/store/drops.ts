import { create } from 'zustand';
import type { Drop } from '@trsr/types';

interface DropsStore {
  drops: Record<string, Drop>;
  setDrops: (drops: Drop[]) => void;
  upsertDrop: (drop: Drop) => void;
  removeDrop: (id: string) => void;
  selectedDropId: string | null;
  setSelectedDropId: (id: string | null) => void;
}

export const useDropsStore = create<DropsStore>((set) => ({
  drops: {},
  setDrops: (drops) =>
    set(() => {
      const map: Record<string, Drop> = {};
      for (const d of drops) map[d.id] = d;
      return { drops: map };
    }),
  upsertDrop: (drop) =>
    set((state) => ({ drops: { ...state.drops, [drop.id]: drop } })),
  removeDrop: (id) =>
    set((state) => {
      const next = { ...state.drops };
      delete next[id];
      return { drops: next };
    }),
  selectedDropId: null,
  setSelectedDropId: (id) => set({ selectedDropId: id }),
}));
