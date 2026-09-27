-- Copied verbatim from docs/04-BACKEND-SCHEMA.md §4 (v1.1). Do not edit here; change the doc first.
-- ============ ENUMS ============
CREATE TYPE persona_role AS ENUM ('client', 'freelancer', 'arbitrator');

CREATE TYPE contract_status AS ENUM (
  'DRAFT', 'FUNDED', 'EVALUATING', 'ANCHORING', 'CONFIRMING',
  'SUBMITTING_VERDICT', 'RELEASED', 'HELD', 'REFUNDED', 'ERROR'
);

CREATE TYPE hold_reason AS ENUM ('FAILED_VERDICT', 'EVALUATION_ERROR');

CREATE TYPE tx_kind AS ENUM ('CREATE_ESCROW', 'SUBMIT_VERDICT', 'RESOLVE_DISPUTE');

-- ============ PERSONAS ============
CREATE TABLE personas (
  id            SMALLSERIAL PRIMARY KEY,
  role          persona_role NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  account_id    TEXT NOT NULL UNIQUE CHECK (account_id ~ '^0\.0\.[0-9]+$'),
  evm_address   TEXT NOT NULL UNIQUE CHECK (evm_address ~ '^0x[0-9a-f]{40}$')   -- lowercase only
);

-- ============ CONTRACTS ============
CREATE TABLE contracts (
  id                BIGSERIAL PRIMARY KEY,
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  sow               TEXT NOT NULL CHECK (char_length(sow) BETWEEN 50 AND 4000),       -- normalized (TRD §5.2)
  sow_hash          CHAR(64) NOT NULL CHECK (sow_hash ~ '^[0-9a-f]{64}$'),            -- sha256(utf8(normalized sow))
  amount_tinybars   BIGINT NOT NULL CHECK (amount_tinybars > 0 AND amount_tinybars <= 10000000000),  -- ≤ 100 ℏ
  client_id         SMALLINT NOT NULL REFERENCES personas(id),
  freelancer_id     SMALLINT NOT NULL REFERENCES personas(id),
  arbitrator_id     SMALLINT NOT NULL REFERENCES personas(id),
  status            contract_status NOT NULL DEFAULT 'DRAFT',
  hold_reason       hold_reason,
  escrow_id         BIGINT UNIQUE,                 -- on-chain id from EscrowCreated
  disputed          BOOLEAN NOT NULL DEFAULT FALSE,
  dispute_reason    TEXT,
  error_step        contract_status,               -- step to resume from when status = ERROR
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (client_id <> freelancer_id AND arbitrator_id <> client_id AND arbitrator_id <> freelancer_id),
  CHECK ((status = 'HELD') = (hold_reason IS NOT NULL)),
  CHECK (status = 'DRAFT' OR escrow_id IS NOT NULL),
  CHECK ((status = 'ERROR') = (error_step IS NOT NULL))
);
CREATE INDEX contracts_status_idx     ON contracts(status);
CREATE INDEX contracts_client_idx     ON contracts(client_id);
CREATE INDEX contracts_freelancer_idx ON contracts(freelancer_id);
CREATE INDEX contracts_arbitrator_idx ON contracts(arbitrator_id);

-- ============ DELIVERABLES ============
CREATE TABLE deliverables (
  id            BIGSERIAL PRIMARY KEY,
  contract_id   BIGINT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,  -- one per contract (MVP)
  content       TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),     -- normalized; NUL rejected by the API
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ EVALUATIONS ============
CREATE TABLE evaluations (
  id                   BIGSERIAL PRIMARY KEY,
  contract_id          BIGINT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
  criteria             JSONB NOT NULL,             -- [{id, description, required}] — the criteria cache (TRD §8.2)
  results              JSONB,                      -- [{id, met, evidence}]; NOT hashed in v1
  confidence           NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  injection_suspected  BOOLEAN NOT NULL DEFAULT FALSE,   -- model flag OR regex backstop
  -- ---- hashed fields (exact strings) ----
  verdict              TEXT CHECK (verdict IN ('pass', 'fail')),
  reasoning            TEXT CHECK (char_length(reasoning) <= 3000),
  model_version        TEXT,
  record_timestamp     TEXT CHECK (record_timestamp ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'),
  -- ---- bookkeeping ----
  record_hash          CHAR(64),                   -- hash at anchoring time; never served by /verify
  record_bytes         INTEGER CHECK (record_bytes <= 18000),
  attempts             SMALLINT NOT NULL DEFAULT 0,
  raw_output           JSONB,                      -- last raw model JSON, for debugging; never served
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ HCS ANCHORS ============
CREATE TABLE hcs_anchors (
  id                   BIGSERIAL PRIMARY KEY,
  contract_id          BIGINT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
  topic_id             TEXT NOT NULL CHECK (topic_id ~ '^0\.0\.[0-9]+$'),
  tx_id                TEXT NOT NULL,              -- chunk 1's transaction id (SDK format 0.0.x@s.n)
  sequence_first       BIGINT NOT NULL,            -- from the receipt of the first chunk (executeAll)
  sequence_last        BIGINT NOT NULL,            -- from the receipt of the last chunk
  chunk_count          SMALLINT NOT NULL CHECK (chunk_count BETWEEN 1 AND 20),
  consensus_timestamp  TEXT,                       -- mirror format "1759501329.481234567" (last chunk)
  confirmed_at         TIMESTAMPTZ,                -- set when the mirror-node hash matched; the visibility gate
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sequence_last - sequence_first + 1 >= chunk_count)
);

-- ============ CHAIN TRANSACTIONS ============
CREATE TABLE chain_txs (
  id            BIGSERIAL PRIMARY KEY,
  contract_id   BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind          tx_kind NOT NULL,
  tx_hash       TEXT NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  succeeded     BOOLEAN NOT NULL,
  events        JSONB,                             -- decoded events [{name, args}]
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chain_txs_contract_idx ON chain_txs(contract_id, created_at);

-- ============ TIMELINE ============
CREATE TABLE timeline_events (
  id            BIGSERIAL PRIMARY KEY,
  contract_id   BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,        -- created|funded|submitted|evaluated|anchored|confirmed|verdict|held|released|refunded|disputed|error|retried|reconciled
  message       TEXT NOT NULL,        -- never contains the verdict before confirmation (FR-11)
  ref           JSONB,                -- {"tx_hash": ...} | {"topic_id": ..., "sequence": ...}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX timeline_contract_idx ON timeline_events(contract_id, created_at);

-- ============ updated_at trigger ============
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER contracts_touch   BEFORE UPDATE ON contracts   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER evaluations_touch BEFORE UPDATE ON evaluations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============ CANONICAL RECORD VIEW ============
-- The single definition of "the record the app shows". Keys match TRD §5.1 exactly.
-- Read by the pipeline at hash time (before anchoring) and by /verify (which adds the
-- confirmed_at gate). Python drops db_contract_id before canonicalizing.
CREATE VIEW v_canonical_record AS
SELECT
  c.id                               AS db_contract_id,
  c.escrow_id::text                  AS contract_id,
  d.content                          AS deliverable,
  e.model_version                    AS model_version,
  e.reasoning                        AS reasoning,
  'vte-record/1'::text               AS schema,
  c.sow                              AS sow,
  e.record_timestamp                 AS "timestamp",
  e.verdict                          AS verdict
FROM contracts c
JOIN deliverables d ON d.contract_id = c.id
JOIN evaluations  e ON e.contract_id = c.id
WHERE e.verdict IS NOT NULL;
