-- D1 schema for minimal features used by frontend today
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS fish (
  id TEXT PRIMARY KEY,
  userId TEXT,
  artist TEXT,
  image TEXT,
  CreatedAt TEXT,
  isVisible INTEGER DEFAULT 1,
  deleted INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  hotScore INTEGER DEFAULT 0,
  needsModeration INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fish_created_at ON fish (CreatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_fish_score ON fish (score DESC);
CREATE INDEX IF NOT EXISTS idx_fish_hot ON fish (hotScore DESC);
CREATE INDEX IF NOT EXISTS idx_fish_user ON fish (userId);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  fishId TEXT,
  reason TEXT,
  userAgent TEXT,
  url TEXT,
  createdAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_fish ON reports (fishId);


