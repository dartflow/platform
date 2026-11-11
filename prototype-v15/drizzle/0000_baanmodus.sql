CREATE TABLE baan_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE baan_boards (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  operation TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE baan_actions (
  board_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  message TEXT,
  PRIMARY KEY (board_id, actor_id, request_id)
);
--> statement-breakpoint
CREATE TABLE baan_history (
  actor_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  finished_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (actor_id, match_id)
);
--> statement-breakpoint
CREATE INDEX baan_history_actor_at ON baan_history (actor_id, finished_at DESC);
