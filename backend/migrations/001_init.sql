-- Neon Rush 3D — esquema inicial
-- Todas as regras de dinheiro, cargos e recompensas são reforçadas aqui com restrições.

CREATE TABLE users (
  id                           BIGSERIAL PRIMARY KEY,
  public_id                    TEXT NOT NULL UNIQUE CHECK (public_id ~ '^NR3D-[A-Z0-9]{8}$'),
  username                     TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9_.]{3,20}$'),
  password_hash                TEXT NOT NULL,
  role                         TEXT NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('OWNER','ADMIN','MOD','PLAYER')),
  is_original_owner            BOOLEAN NOT NULL DEFAULT false,
  is_influencer                BOOLEAN NOT NULL DEFAULT false,
  influencer_reward_granted_at TIMESTAMPTZ,
  coins                        BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  selected_character           TEXT NOT NULL DEFAULT 'runner',
  has_cape                     BOOLEAN NOT NULL DEFAULT false,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at                TIMESTAMPTZ,
  CONSTRAINT original_owner_keeps_owner CHECK (NOT is_original_owner OR role = 'OWNER')
);
CREATE UNIQUE INDEX users_username_lower_uniq ON users (lower(username));
CREATE UNIQUE INDEX users_one_original_owner ON users (is_original_owner) WHERE is_original_owner;

-- IDs públicos nunca são reutilizados, mesmo se uma conta for removida manualmente.
CREATE TABLE public_ids (
  public_id  TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Linha única: só existe UM OWNER original, gravado para sempre.
CREATE TABLE owner_bootstrap (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  user_id      BIGINT NOT NULL UNIQUE REFERENCES users(id),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT,
  user_agent     TEXT,
  ip             TEXT
);
CREATE INDEX sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE coin_ledger (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         BIGINT NOT NULL,
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  reason        TEXT NOT NULL,
  ref           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX coin_ledger_user ON coin_ledger (user_id, created_at DESC);

CREATE TABLE user_characters (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('shop','code','admin')),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE purchases (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id  TEXT NOT NULL,
  price         INT NOT NULL CHECK (price >= 0),
  paid          INT NOT NULL CHECK (paid >= 0),
  infinite      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, character_id)
);

CREATE TABLE game_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('classic','easy','nocoin')),
  status        TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','finished','rejected')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  distance      NUMERIC(12,2),
  coins         INT,
  duration      NUMERIC(10,2),
  score         NUMERIC(12,2),
  reject_reason TEXT
);
CREATE INDEX game_runs_user ON game_runs (user_id, started_at DESC);

CREATE TABLE best_scores (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL CHECK (mode IN ('classic','easy','nocoin')),
  score      NUMERIC(12,2) NOT NULL CHECK (score >= 0),
  run_id     UUID REFERENCES game_runs(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mode)
);
CREATE INDEX best_scores_board ON best_scores (mode, score DESC);

CREATE TABLE promo_codes (
  code         TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{4,16}$'),
  -- Códigos nunca concedem cargos: só personagem, capa, moedas ou prêmio surpresa.
  reward_type  TEXT NOT NULL CHECK (reward_type IN ('character','cape','coins','surprise')),
  reward_value TEXT,
  max_uses     INT CHECK (max_uses IS NULL OR max_uses > 0),
  uses         INT NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at   TIMESTAMPTZ,
  active       BOOLEAN NOT NULL DEFAULT true,
  is_builtin   BOOLEAN NOT NULL DEFAULT false,
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promo_uses_limit CHECK (max_uses IS NULL OR uses <= max_uses)
);

CREATE TABLE code_redemptions (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL REFERENCES promo_codes(code),
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_type  TEXT NOT NULL,
  reward_value TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, user_id)
);

CREATE TABLE chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  BIGINT REFERENCES users(id)
);
CREATE INDEX chat_messages_recent ON chat_messages (created_at DESC);

CREATE TABLE chat_mutes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_by   BIGINT NOT NULL REFERENCES users(id),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id)
);
CREATE INDEX chat_mutes_user ON chat_mutes (user_id, expires_at DESC);

CREATE TABLE conversations (
  id              BIGSERIAL PRIMARY KEY,
  user_a          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);
CREATE INDEX conversations_a ON conversations (user_a, last_message_at DESC);
CREATE INDEX conversations_b ON conversations (user_b, last_message_at DESC);

CREATE TABLE dm_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  client_nonce    TEXT NOT NULL CHECK (char_length(client_nonce) BETWEEN 6 AND 64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ,
  UNIQUE (sender_id, client_nonce)
);
CREATE INDEX dm_messages_conv ON dm_messages (conversation_id, created_at DESC);

CREATE TABLE blocks (
  blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  content    TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE reports (
  id              BIGSERIAL PRIMARY KEY,
  reporter_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        TEXT NOT NULL CHECK (category IN ('OFENSAS','ASSEDIO','TRAPACAS','EXPLOITS','MANIPULACAO_PONTUACAO','COMPORTAMENTO_INADEQUADO','SPAM','ABUSO_BUGS','OUTROS')),
  description     TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  context_type    TEXT NOT NULL CHECK (context_type IN ('player','chat','dm')),
  chat_message_id BIGINT REFERENCES chat_messages(id),
  dm_message_id   BIGINT REFERENCES dm_messages(id),
  evidence        JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'NOVA' CHECK (status IN ('NOVA','EM_ANALISE','PROCEDENTE','NAO_PROCEDENTE','ENCERRADA')),
  assigned_to     BIGINT REFERENCES users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_id)
);
CREATE INDEX reports_status ON reports (status, created_at DESC);

CREATE TABLE bans (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by     BIGINT NOT NULL REFERENCES users(id),
  reason        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,          -- NULL = permanente
  revoked_at    TIMESTAMPTZ,
  revoked_by    BIGINT REFERENCES users(id),
  revoke_reason TEXT
);
CREATE INDEX bans_user ON bans (user_id, created_at DESC);

CREATE TABLE kicks (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kicked_by  BIGINT NOT NULL REFERENCES users(id),
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_changes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_role   TEXT NOT NULL,
  new_role   TEXT NOT NULL,
  changed_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE influencer_log (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action         TEXT NOT NULL CHECK (action IN ('GRANT','REVOKE')),
  by_user        BIGINT NOT NULL REFERENCES users(id),
  reward_granted BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_achievements (
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   BIGINT REFERENCES users(id),
  action     TEXT NOT NULL,
  target_id  BIGINT REFERENCES users(id),
  details    JSONB NOT NULL DEFAULT '{}',
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_recent ON audit_log (created_at DESC);
CREATE INDEX audit_log_action ON audit_log (action, created_at DESC);

-- Códigos originais do jogo (preservados).
INSERT INTO promo_codes (code, reward_type, reward_value, is_builtin) VALUES
  ('NEONRUN', 'surprise',  NULL,     true),
  ('RAILRSH', 'surprise',  NULL,     true),
  ('TRAVESO', 'character', 'menino', true),
  ('YURIZAO', 'character', 'yuri',   true),
  ('VERITYY', 'character', 'verity', true);
