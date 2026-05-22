-- Current SQLite schema for runtime chat state + inference telemetry
--
-- Telemetry policy:
-- - input_preview and output_preview are persisted by default as safe inspection fields
-- - preview redaction/truncation happens before persistence in the runtime
-- - raw_request_json and raw_response_json are NULL unless explicitly enabled

PRAGMA foreign_keys = ON;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  committed_assistant_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE inference_requests (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'completed', 'failed', 'cancelled')),
  input_preview TEXT,
  output_preview TEXT,
  raw_request_json TEXT,
  raw_response_json TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE inference_events (
  id TEXT PRIMARY KEY,
  inference_request_id TEXT NOT NULL REFERENCES inference_requests(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('response_start', 'first_token', 'usage', 'request_end')),
  created_at TEXT NOT NULL,
  payload_json TEXT,
  UNIQUE (inference_request_id, sequence_number)
);

CREATE INDEX idx_messages_conversation_created_at
  ON messages (conversation_id, created_at);

CREATE INDEX idx_turns_conversation_created_at
  ON turns (conversation_id, created_at);

CREATE INDEX idx_inference_requests_turn_attempt
  ON inference_requests (turn_id, attempt_number);

CREATE INDEX idx_inference_events_request_sequence
  ON inference_events (inference_request_id, sequence_number);
