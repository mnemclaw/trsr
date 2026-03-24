CREATE EXTENSION IF NOT EXISTS postgis;

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
  location     GEOGRAPHY(POINT, 4326) NOT NULL,
  owner_id     TEXT NOT NULL REFERENCES users(id),
  upvotes      INTEGER NOT NULL DEFAULT 0,
  downvotes    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired'))
);

CREATE INDEX drops_location_idx ON drops USING GIST (location);
CREATE INDEX drops_expires_at_idx ON drops (expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id      UUID NOT NULL REFERENCES drops(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  vote_type    TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drop_id, user_id)
);
