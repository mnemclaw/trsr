export type DropStatus = 'active' | 'expired';
export type VoteType = 'up' | 'down';
export type DropAge = 'fresh' | 'recent' | 'mid' | 'old' | 'stale';

export interface Drop {
  id: string;
  text: string;
  link?: string;
  imageCid?: string;
  lat: number;
  lng: number;
  ownerId: string;
  upvotes: number;
  downvotes: number;
  createdAt: string; // ISO
  expiresAt: string; // ISO
  status: DropStatus;
}

export interface User {
  id: string; // wallet address or 'anon:<session>'
  createdAt: string;
  dropCount: number;
  voteCount: number;
}

export interface Vote {
  id: string;
  dropId: string;
  userId: string;
  voteType: VoteType;
  createdAt: string;
}

export interface CreateDropInput {
  text: string;
  link?: string;
  imageCid?: string;
  lat: number;
  lng: number;
  ownerId: string;
}

export interface BboxQuery {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Helper: compute drop age state from createdAt timestamp
export function dropAgeState(createdAt: string): DropAge {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 6) return 'fresh';
  if (ageHours < 24) return 'recent';
  if (ageHours < 72) return 'mid';      // 1–3 days
  if (ageHours < 168) return 'old';     // 3–7 days
  return 'stale';                        // > 7 days
}

export const DROP_AGE_COLOURS: Record<DropAge, string> = {
  fresh: '#FBBBAD',   // soft coral   — newest/hottest drops
  recent: '#F3CBE8',  // lavender pink — recent drops
  mid: '#E9C5C2',     // dusty rose    — medium-age drops
  old: '#F6E9D9',     // warm cream    — older drops
  stale: '#E9C5C2',   // dusty rose    — fading out (lower opacity applied at render)
};
