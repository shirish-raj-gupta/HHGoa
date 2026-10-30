-- What the merchant signs for a public reply, between prepare and publish.
ALTER TABLE merchant_replies ADD COLUMN signing jsonb;
