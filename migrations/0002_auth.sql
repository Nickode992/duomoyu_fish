-- Auth tables for email/password and reset tokens
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  displayName TEXT,
  isAdmin INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  used INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets (email);

