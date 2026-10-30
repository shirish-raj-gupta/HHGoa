-- Provider version, city hint and other per-request context for in-flight proofs.
ALTER TABLE proof_requests ADD COLUMN meta jsonb NOT NULL DEFAULT '{}';
