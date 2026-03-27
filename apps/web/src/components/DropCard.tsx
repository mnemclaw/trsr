import { useDropsStore } from '../store/drops.js';
import { voteDrop } from '../api/drops.js';

function getAnonymousUserId(): string {
  const key = 'trsr:uid';
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(key, uid);
  }
  return uid;
}

function formatTimeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d remaining`;
}

export function DropCard() {
  const selectedDropId = useDropsStore((s) => s.selectedDropId);
  const drops = useDropsStore((s) => s.drops);
  const setSelectedDropId = useDropsStore((s) => s.setSelectedDropId);
  const upsertDrop = useDropsStore((s) => s.upsertDrop);

  if (!selectedDropId) return null;
  const drop = drops[selectedDropId];
  if (!drop) return null;

  async function handleVote(voteType: 'up' | 'down') {
    const userId = getAnonymousUserId();
    try {
      const updated = await voteDrop(drop.id, userId, voteType);
      upsertDrop(updated);
    } catch {
      // silently ignore vote errors (e.g. already voted)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: 'var(--color-cream)',
        color: '#1a1a1a',
        padding: '16px',
        borderRadius: '12px 12px 0 0',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
        borderTop: '3px solid var(--color-lime)',
        maxHeight: '40vh',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ margin: 0, flex: 1, fontSize: '15px', lineHeight: '1.5' }}>{drop.text}</p>
        <button
          onClick={() => setSelectedDropId(null)}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            fontSize: '20px',
            cursor: 'pointer',
            marginLeft: '12px',
            padding: 0,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {drop.link && (
        <a
          href={drop.link}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--color-lime)', fontSize: '13px', display: 'block', marginTop: '8px' }}
        >
          {drop.link}
        </a>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginTop: '12px',
          fontSize: '13px',
          color: '#888',
        }}
      >
        <span>{formatTimeRemaining(drop.expiresAt)}</span>
        <span>↑ {drop.upvotes}</span>
        <span>↓ {drop.downvotes}</span>
        <button
          onClick={() => void handleVote('up')}
          style={{
            background: 'var(--color-coral)',
            border: 'none',
            borderRadius: '6px',
            color: '#1a1a1a',
            padding: '4px 12px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Upvote
        </button>
        <button
          onClick={() => void handleVote('down')}
          style={{
            background: 'var(--color-rose)',
            border: 'none',
            borderRadius: '6px',
            color: '#1a1a1a',
            padding: '4px 12px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Downvote
        </button>
      </div>
    </div>
  );
}
