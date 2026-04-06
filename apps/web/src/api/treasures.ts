const API = import.meta.env.VITE_API_URL ?? '';

export interface TreasureToken {
  id: string;
  lat: number;
  lng: number;
}

export async function fetchTreasures(lat: number, lng: number): Promise<TreasureToken[]> {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  const res = await fetch(`${API}/api/treasures?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error('Failed to fetch treasures');
  const data = (await res.json()) as { treasures: TreasureToken[] };
  return data.treasures;
}

export async function collectTreasure(
  id: string,
  playerId: string,
  lat: number,
  lng: number,
  dayNumber: number,
): Promise<{ balance: number }> {
  const res = await fetch(`${API}/api/treasures/${encodeURIComponent(id)}/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, lat, lng, dayNumber }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 409) {
    // Already collected — fetch current balance
    const balRes = await fetch(`${API}/api/players/${encodeURIComponent(playerId)}/balance`);
    const balData = (await balRes.json()) as { balance: number };
    return balData;
  }
  if (!res.ok) throw new Error('Failed to collect treasure');
  return res.json() as Promise<{ balance: number }>;
}

export async function fetchPlayerBalance(playerId: string): Promise<number> {
  const res = await fetch(`${API}/api/players/${encodeURIComponent(playerId)}/balance`);
  if (!res.ok) return 0;
  const data = (await res.json()) as { balance: number };
  return data.balance;
}
