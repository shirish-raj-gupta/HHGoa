-- Cities beyond the configured four: a business anywhere in India can add its listing, and its city is made from
-- Google's map of it (Geocoding: the locality and its viewport). Configured cities keep source = 'config'.
ALTER TABLE cities ADD COLUMN state text;
ALTER TABLE cities ADD COLUMN source text NOT NULL DEFAULT 'config';
