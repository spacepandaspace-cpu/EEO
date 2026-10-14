CREATE TABLE IF NOT EXISTS workbench_ticket (
  jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workbench_ticket_expiry ON workbench_ticket(expires_at);
