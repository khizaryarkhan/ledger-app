-- Rep tier: 'rep' (default) | 'rd' | 'ed'
-- manager_id: ED/RD that this rep reports to (null for ED/RD themselves)
ALTER TABLE reps ADD COLUMN IF NOT EXISTS tier VARCHAR(16) NOT NULL DEFAULT 'rep';
ALTER TABLE reps ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES reps(id) ON DELETE SET NULL;
