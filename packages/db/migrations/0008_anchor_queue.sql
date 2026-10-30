-- A review whose anchoring failed for a passing reason (the relayer out of gas, Base not answering) is published at
-- once and keeps the reviewer's signed attestation here; the anchor-pending job submits it until it lands or its
-- deadline (7 days) passes. NULL once anchored, or for reviews that never anchor (no chain configured).
ALTER TABLE reviews ADD COLUMN anchor jsonb;
CREATE INDEX reviews_anchor_pending ON reviews ((anchor IS NOT NULL)) WHERE eas_uid IS NULL;
