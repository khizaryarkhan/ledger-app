-- Add customisable stages JSONB to organisations
-- Existing orgs get the default stage set seeded automatically.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS stages jsonb;

UPDATE organisations
SET stages = '[
  {"key":"New",          "label":"New",           "color":"stone",   "isDefault":true, "isClosed":false,"visible":true},
  {"key":"Scheduled",    "label":"Scheduled",     "color":"blue",    "isDefault":false,"isClosed":false,"visible":true},
  {"key":"Reminder Sent","label":"Reminder Sent", "color":"blue",    "isDefault":false,"isClosed":false,"visible":true},
  {"key":"Second Notice","label":"Second Notice", "color":"violet",  "isDefault":false,"isClosed":false,"visible":true},
  {"key":"Final Notice", "label":"Final Notice",  "color":"violet",  "isDefault":false,"isClosed":false,"visible":true},
  {"key":"Awaiting",     "label":"Awaiting",      "color":"amber",   "isDefault":false,"isClosed":false,"visible":true},
  {"key":"Promised",     "label":"Promised",      "color":"amber",   "isDefault":false,"isClosed":false,"visible":true},
  {"key":"Disputed",     "label":"Disputed",      "color":"rose",    "isDefault":false,"isClosed":false,"visible":true},
  {"key":"Escalated",    "label":"Escalated",     "color":"rose",    "isDefault":false,"isClosed":false,"visible":true},
  {"key":"On Hold",      "label":"On Hold",       "color":"orange",  "isDefault":false,"isClosed":false,"visible":true},
  {"key":"Closed",       "label":"Closed",        "color":"emerald", "isDefault":false,"isClosed":true, "visible":true}
]'::jsonb
WHERE stages IS NULL;
