-- ShiftGo PostgreSQL schema. Equivalent to drizzle/0000..0002 (SQLite / Cloudflare D1).
-- Applied automatically at startup by lib/node-runtime.ts when DATABASE_URL is set.
--
-- Conventions kept identical to the SQLite schema so the same SQL runs on both:
--   * timestamps are ISO-8601 text (new Date().toISOString()), flags are integers 0/1
--   * every text column uses COLLATE "C" = byte order, like SQLite's BINARY collation,
--     so comparisons and ORDER BY on timestamps/ids behave exactly as on SQLite.
-- New schema changes: add db/migrations-pg/0001_<name>.sql (and the SQLite equivalent in drizzle/).

CREATE TABLE IF NOT EXISTS app_settings (
  id          text COLLATE "C" PRIMARY KEY NOT NULL,
  value       text COLLATE "C" NOT NULL,
  updated_at  text COLLATE "C" NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          text COLLATE "C" PRIMARY KEY NOT NULL,
  actor_id    text COLLATE "C" NOT NULL,
  action      text COLLATE "C" NOT NULL,
  target_id   text COLLATE "C" NOT NULL,
  details     text COLLATE "C" NOT NULL,
  created_at  text COLLATE "C" NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_state (
  id          text COLLATE "C" PRIMARY KEY NOT NULL,
  value       text COLLATE "C" NOT NULL,
  updated_at  text COLLATE "C" NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id           text COLLATE "C" PRIMARY KEY NOT NULL,
  name         text COLLATE "C" NOT NULL,
  description  text COLLATE "C" DEFAULT '' NOT NULL,
  permissions  text COLLATE "C" DEFAULT '[]' NOT NULL,
  created_at   text COLLATE "C" NOT NULL,
  updated_at   text COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique ON roles (name);

CREATE TABLE IF NOT EXISTS employees (
  id                    text COLLATE "C" PRIMARY KEY NOT NULL,
  employee_code         text COLLATE "C" NOT NULL,
  name                  text COLLATE "C" NOT NULL,
  email                 text COLLATE "C" NOT NULL,
  phone                 text COLLATE "C" DEFAULT '' NOT NULL,
  department            text COLLATE "C" DEFAULT '' NOT NULL,
  role                  text COLLATE "C" DEFAULT 'employee' NOT NULL,
  active                integer DEFAULT 1 NOT NULL,
  password_hash         text COLLATE "C" NOT NULL,
  must_change_password  integer DEFAULT 1 NOT NULL,
  created_at            text COLLATE "C" NOT NULL,
  updated_at            text COLLATE "C" NOT NULL,
  location              text COLLATE "C" DEFAULT '' NOT NULL,
  last_active_at        text COLLATE "C",
  deleted_at            text COLLATE "C",
  sso_subject           text COLLATE "C"
);
CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_code_unique ON employees (employee_code);
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_unique ON employees (email);

CREATE TABLE IF NOT EXISTS trips (
  id                text COLLATE "C" PRIMARY KEY NOT NULL,
  employee_id       text COLLATE "C" NOT NULL REFERENCES employees (id),
  direction         text COLLATE "C" NOT NULL,
  status            text COLLATE "C" DEFAULT 'active' NOT NULL,
  cab               text COLLATE "C" DEFAULT '' NOT NULL,
  boarded_at        text COLLATE "C" NOT NULL,
  arrived_at        text COLLATE "C",
  board_location    text COLLATE "C" NOT NULL,
  arrival_location  text COLLATE "C"
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip_per_employee ON trips (employee_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS trips_boarded_at_idx ON trips (boarded_at);

CREATE TABLE IF NOT EXISTS events (
  id           text COLLATE "C" PRIMARY KEY NOT NULL,
  event_id     text COLLATE "C" NOT NULL,
  employee_id  text COLLATE "C" NOT NULL REFERENCES employees (id),
  trip_id      text COLLATE "C" REFERENCES trips (id),
  type         text COLLATE "C" NOT NULL,
  server_time  text COLLATE "C" NOT NULL,
  device_time  text COLLATE "C",
  location     text COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_event_idempotency ON events (employee_id, event_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_arrival_per_trip ON events (trip_id) WHERE type = 'arrive';

CREATE TABLE IF NOT EXISTS sos (
  id                  text COLLATE "C" PRIMARY KEY NOT NULL,
  employee_id         text COLLATE "C" NOT NULL REFERENCES employees (id),
  trip_id             text COLLATE "C" REFERENCES trips (id),
  event_id            text COLLATE "C" NOT NULL REFERENCES events (id),
  status              text COLLATE "C" DEFAULT 'open' NOT NULL,
  created_at          text COLLATE "C" NOT NULL,
  acknowledged_at     text COLLATE "C",
  acknowledged_by     text COLLATE "C",
  resolved_at         text COLLATE "C",
  note                text COLLATE "C" DEFAULT '' NOT NULL,
  location            text COLLATE "C" NOT NULL,
  escalation_count    integer DEFAULT 0 NOT NULL,
  next_escalation_at  text COLLATE "C"
);
CREATE UNIQUE INDEX IF NOT EXISTS sos_event_id_unique ON sos (event_id);

CREATE TABLE IF NOT EXISTS reports (
  id               text COLLATE "C" PRIMARY KEY NOT NULL,
  period_start     text COLLATE "C" NOT NULL,
  period_end       text COLLATE "C" NOT NULL,
  generated_at     text COLLATE "C" NOT NULL,
  trip_count       integer NOT NULL,
  completed_count  integer NOT NULL,
  active_count     integer NOT NULL,
  sos_count        integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS report_period_unique ON reports (period_start, period_end);

CREATE TABLE IF NOT EXISTS notifications (
  id                text COLLATE "C" PRIMARY KEY NOT NULL,
  event_id          text COLLATE "C" REFERENCES events (id),
  sos_id            text COLLATE "C" REFERENCES sos (id),
  report_id         text COLLATE "C" REFERENCES reports (id),
  kind              text COLLATE "C" NOT NULL,
  channel           text COLLATE "C" NOT NULL,
  status            text COLLATE "C" DEFAULT 'pending' NOT NULL,
  payload           text COLLATE "C" NOT NULL,
  attempts          integer DEFAULT 0 NOT NULL,
  created_at        text COLLATE "C" NOT NULL,
  next_attempt_at   text COLLATE "C" NOT NULL,
  last_attempt_at   text COLLATE "C",
  sent_at           text COLLATE "C",
  lease_token       text COLLATE "C",
  lease_expires_at  text COLLATE "C",
  provider_id       text COLLATE "C",
  error             text COLLATE "C" DEFAULT '' NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_due_idx ON notifications (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS notification_attempts (
  id               text COLLATE "C" PRIMARY KEY NOT NULL,
  notification_id  text COLLATE "C" NOT NULL REFERENCES notifications (id),
  lease_token      text COLLATE "C" NOT NULL,
  status           text COLLATE "C" NOT NULL,
  created_at       text COLLATE "C" NOT NULL,
  error            text COLLATE "C" DEFAULT '' NOT NULL,
  provider_id      text COLLATE "C"
);
CREATE UNIQUE INDEX IF NOT EXISTS receipt_lease_unique ON notification_attempts (notification_id, lease_token);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            text COLLATE "C" PRIMARY KEY NOT NULL,
  count         integer NOT NULL,
  window_start  integer NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           text COLLATE "C" PRIMARY KEY NOT NULL,
  employee_id  text COLLATE "C" NOT NULL REFERENCES employees (id),
  expires_at   text COLLATE "C" NOT NULL,
  created_at   text COLLATE "C" NOT NULL
);

CREATE TABLE IF NOT EXISTS settings_revisions (
  id          text COLLATE "C" PRIMARY KEY NOT NULL,
  value       text COLLATE "C" NOT NULL,
  actor_id    text COLLATE "C" NOT NULL,
  created_at  text COLLATE "C" NOT NULL
);

-- Starter custom roles (editable/deletable in Admin → Access control).
INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
  ('transport_manager', 'Transport manager', 'Monitors journeys, responds to SOS alerts and downloads reports.',
   '["dashboard.view","alerts.manage","reports.view","employees.manage"]',
   to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  ('security_desk', 'Security desk', 'Watches live journeys and handles SOS alerts.',
   '["dashboard.view","alerts.manage"]',
   to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT DO NOTHING;
