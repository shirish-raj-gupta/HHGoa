-- What the reviewer signs to answer a check-in (typed data or message), between prepare and answer.
ALTER TABLE followups ADD COLUMN signing jsonb;
