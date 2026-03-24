import { useState, useRef } from 'react';
import { createDrop } from '../api/drops.js';
import { useDropsStore } from '../store/drops.js';

interface CreateDropModalProps {
  mapCenter: { lat: number; lng: number };
  onClose: () => void;
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

function CreateDropModal({ mapCenter, onClose }: CreateDropModalProps) {
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
          background: '#1e293b',
          color: '#f1f5f9',
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
                background: '#0f172a',
                color: '#f1f5f9',
                border: '1px solid #334155',
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
                background: '#0f172a',
                color: '#f1f5f9',
                border: '1px solid #334155',
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
                background: '#334155',
                border: 'none',
                borderRadius: '8px',
                color: '#f1f5f9',
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
                background: '#3b82f6',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
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
}

export function CreateDropButton({ getMapCenter }: CreateDropButtonProps) {
  const [open, setOpen] = useState(false);
  const centerRef = useRef<{ lat: number; lng: number }>({ lat: 0, lng: 0 });

  function handleOpen() {
    centerRef.current = getMapCenter();
    setOpen(true);
  }

  return (
    <>
      <button
        onClick={handleOpen}
        aria-label="Create drop"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 1000,
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: '#3b82f6',
          color: '#fff',
          border: 'none',
          fontSize: '28px',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
        }}
      >
        +
      </button>
      {open && (
        <CreateDropModal mapCenter={centerRef.current} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
