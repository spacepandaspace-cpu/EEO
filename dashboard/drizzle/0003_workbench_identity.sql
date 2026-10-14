CREATE TABLE IF NOT EXISTS external_identity (
 job_number TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(user_id) REFERENCES user_account(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workbench_session (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, job_number TEXT NOT NULL,
 expires_at TEXT NOT NULL, checked_at TEXT NOT NULL, token_cipher TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(user_id) REFERENCES user_account(id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workbench_session_expiry ON workbench_session(expires_at);
