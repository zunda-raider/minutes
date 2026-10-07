-- Meeting notebooks + transcript cards (議事録)
-- Applied by docker-entrypoint-initdb.d on first Postgres start,
-- or via: npm run db:migrate

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  meeting_date DATE NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meeting_cards (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  note DOUBLE PRECISION NOT NULL,
  text TEXT NOT NULL,
  lang TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  text_ja TEXT,
  speaker_id INTEGER,
  source TEXT CHECK (source IS NULL OR source IN ('mic', 'system'))
);

CREATE INDEX IF NOT EXISTS meeting_cards_meeting_id_idx
  ON meeting_cards (meeting_id);

CREATE INDEX IF NOT EXISTS meetings_date_created_idx
  ON meetings (meeting_date DESC, created_at DESC);
