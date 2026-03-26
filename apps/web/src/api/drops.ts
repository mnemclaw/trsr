import type { Drop, CreateDropInput, BboxQuery, VoteType } from '@trsr/types';

const API = import.meta.env.VITE_API_URL ?? '';

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

export async function fetchDropsInBbox(bbox: BboxQuery): Promise<Drop[]> {
  const params = new URLSearchParams({
    minLat: String(bbox.minLat),
    maxLat: String(bbox.maxLat),
    minLng: String(bbox.minLng),
    maxLng: String(bbox.maxLng),
  });
  const res = await fetch(`${API}/api/drops?${params.toString()}`, {
    signal: withTimeout(10_000),
  });
  if (!res.ok) throw new Error('Failed to fetch drops');
  const data = (await res.json()) as { drops: Drop[] };
  return data.drops;
}

export async function createDrop(input: CreateDropInput): Promise<Drop> {
  const res = await fetch(`${API}/api/drops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: withTimeout(10_000),
  });
  if (!res.ok) throw new Error('Failed to create drop');
  return res.json() as Promise<Drop>;
}

export async function getDrop(id: string): Promise<Drop> {
  const res = await fetch(`${API}/api/drops/${id}`);
  if (!res.ok) throw new Error('Failed to fetch drop');
  return res.json() as Promise<Drop>;
}

export async function voteDrop(id: string, userId: string, voteType: VoteType): Promise<Drop> {
  const res = await fetch(`${API}/api/drops/${id}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, voteType }),
  });
  if (!res.ok) throw new Error('Failed to vote on drop');
  return res.json() as Promise<Drop>;
}
