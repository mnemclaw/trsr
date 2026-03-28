CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  drop_count   INTEGER NOT NULL DEFAULT 0,
  vote_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drops (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text         TEXT NOT NULL CHECK (char_length(text) <= 500),
  link         TEXT,
  image_cid    TEXT,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  geohash      VARCHAR(12) NOT NULL,
  owner_id     TEXT NOT NULL REFERENCES users(id),
  upvotes      INTEGER NOT NULL DEFAULT 0,
  downvotes    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired'))
);

CREATE INDEX IF NOT EXISTS drops_lat_lng_idx ON drops (lat, lng) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS drops_expires_at_idx ON drops (expires_at) WHERE status = 'active';

-- Collected treasures (only store what's been collected — generation is deterministic)
CREATE TABLE IF NOT EXISTS collected_treasures (
  id TEXT PRIMARY KEY,           -- deterministic ID: "{tile_key}:{day_number}"
  player_id TEXT NOT NULL,
  collected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Player treasure balance
CREATE TABLE IF NOT EXISTS player_balance (
  player_id TEXT PRIMARY KEY,
  treasure_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id      UUID NOT NULL REFERENCES drops(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  vote_type    TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drop_id, user_id)
);
