-- A signed bill QR carries a short code (/scan?c=<id>) instead of the whole signed receipt (about 600 characters,
-- too dense for a camera to read off a screen). The code finds the stored receipt; its signature is checked as before.
ALTER TABLE merchant_receipts ADD COLUMN payload text;
