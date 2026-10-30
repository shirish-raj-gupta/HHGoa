-- Places from Google Maps (Places API). A reviewer who paid by UPI pins which shop it was; businesses add their
-- listing from Google. Place IDs may be kept indefinitely; the name, address and location copied from Google are
-- refreshed within 30 days (the google-places job), as Google's terms ask.
ALTER TABLE merchants ADD COLUMN google_place_id text;
ALTER TABLE merchants ADD COLUMN google_synced_at timestamptz;
ALTER TABLE merchants ADD COLUMN maps_url text;
-- The payee name a UPI payment showed (often the legal name), kept when the shop's own name replaces it.
ALTER TABLE merchants ADD COLUMN payee_name text;
CREATE INDEX merchants_google_place ON merchants (google_place_id);
