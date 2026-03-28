import { useState, useRef } from 'react';
import { createDrop } from '../api/drops.js';
import { useDropsStore } from '../store/drops.js';

const TREASURE_COST = 10;

interface CreateDropModalProps {
  mapCenter: { lat: number; lng: number };
  onClose: () => void;
  onDropCreated?: () => void;
}

function getAnonymousUserId(): string {
  const key = 'trsr:uid';
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(key, uid);
  }
  return uid;
}

function CreateDropModal({ mapCenter, onClose, onDropCreated }: CreateDropModalProps) {
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upsertDrop = useDropsStore((s) => s.upsertDrop);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const drop = await createDrop({
        text: text.trim(),
        link: link.trim() || undefined,
        lat: mapCenter.lat,
        lng: mapCenter.lng,
        ownerId: getAnonymousUserId(),
      });
      upsertDrop(drop);
      onDropCreated?.();
      onClose();
    } catch {
      setError('Failed to create drop. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-cream)',
          color: '#1a1a1a',
          borderRadius: '12px',
          padding: '24px',
          width: '100%',
          maxWidth: '400px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Drop something here</h2>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div style={{ marginBottom: '12px' }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder="What's happening here?"
              rows={4}
              style={{
                width: '100%',
                background: '#fff',
                color: '#1a1a1a',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '14px',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ textAlign: 'right', fontSize: '12px', color: '#64748b' }}>
              {text.length}/500
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Link (optional)"
              style={{
                width: '100%',
                background: '#fff',
                color: '#1a1a1a',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'var(--color-rose)',
                border: 'none',
                borderRadius: '8px',
                color: '#1a1a1a',
                padding: '10px 20px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              style={{
                background: 'var(--color-lime)',
                border: 'none',
                borderRadius: '8px',
                color: '#1a1a1a',
                padding: '10px 20px',
                cursor: 'pointer',
                fontWeight: 600,
                opacity: submitting || !text.trim() ? 0.6 : 1,
              }}
            >
              {submitting ? 'Dropping…' : 'Drop it'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CreateDropButtonProps {
  getMapCenter: () => { lat: number; lng: number };
  balance: number;
  refreshBalance: () => Promise<void>;
}

export function CreateDropButton({ getMapCenter, balance, refreshBalance }: CreateDropButtonProps) {
  const [open, setOpen] = useState(false);
  const centerRef = useRef<{ lat: number; lng: number }>({ lat: 0, lng: 0 });
  const canCreate = balance >= TREASURE_COST;
  const needed = TREASURE_COST - balance;

  function handleOpen() {
    if (!canCreate) return;
    centerRef.current = getMapCenter();
    setOpen(true);
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        {!canCreate && (
          <div
            style={{
              background: 'var(--color-cream)',
              color: '#1a1a1a',
              borderRadius: '20px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 500,
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              whiteSpace: 'nowrap',
            }}
          >
            Collect {needed} more †
          </div>
        )}
        <button
          onClick={handleOpen}
          disabled={!canCreate}
          aria-label="Create drop"
          title={canCreate ? 'Create a drop' : `Collect ${needed} more † to drop`}
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: canCreate ? 'var(--color-lime)' : 'var(--color-rose)',
            color: '#1a1a1a',
            border: 'none',
            fontSize: '28px',
            cursor: canCreate ? 'pointer' : 'not-allowed',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            opacity: canCreate ? 1 : 0.7,
          }}
        >
          +
        </button>
      </div>
      {open && (
        <CreateDropModal
          mapCenter={centerRef.current}
          onClose={() => setOpen(false)}
          onDropCreated={() => void refreshBalance()}
        />
      )}
    </>
  );
}
