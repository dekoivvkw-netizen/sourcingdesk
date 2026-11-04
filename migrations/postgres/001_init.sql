-- Schema iniziale SourcingDesk (PostgreSQL 13+)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  website VARCHAR(2048),
  country VARCHAR(64),
  email VARCHAR(255),
  notes TEXT,
  dedupe_hash CHAR(64) NOT NULL UNIQUE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_suppliers_owner ON suppliers (created_by);
CREATE TABLE IF NOT EXISTS offers (
  id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  price NUMERIC(12,2),
  currency CHAR(3),
  moq INTEGER CHECK (moq >= 0),
  lead_time_days INTEGER CHECK (lead_time_days >= 0),
  description TEXT,
  source VARCHAR(16) NOT NULL DEFAULT 'manual',
  ai_score SMALLINT CHECK (ai_score BETWEEN 0 AND 255),
  ai_summary TEXT,
  ai_source VARCHAR(16),
  dedupe_hash CHAR(64) NOT NULL UNIQUE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_offers_owner ON offers (created_by, created_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT,
  action VARCHAR(64) NOT NULL,
  entity VARCHAR(32) NOT NULL,
  entity_id BIGINT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_log (actor_id, created_at);
