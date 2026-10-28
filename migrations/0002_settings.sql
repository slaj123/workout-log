-- Your choices from the Settings tab (activity types, time zone, lists).
-- One row, name 'app', value = JSON. Falls back to public/setup.js when empty.
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
