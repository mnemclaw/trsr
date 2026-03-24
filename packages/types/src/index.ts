export type DropStatus = 'active' | 'expired';
export type VoteType = 'up' | 'down';
export type DropAge = 'new' | 'healthy' | 'fading' | 'critical';

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

// Helper: compute drop age state from expiresAt
export function dropAgeState(expiresAt: string): DropAge {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  const daysLeft = msLeft / (1000 * 60 * 60 * 24);
  if (daysLeft > 5) return 'new';
  if (daysLeft > 3) return 'healthy';
  if (daysLeft > 1) return 'fading';
  return 'critical';
}

export const DROP_AGE_COLOURS: Record<DropAge, string> = {
  new: '#3b82f6',      // blue-500
  healthy: '#22c55e',  // green-500
  fading: '#eab308',   // yellow-500
  critical: '#ef4444', // red-500
};
