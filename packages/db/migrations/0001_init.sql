-- Receipts schema. The 22 tables from the plan, plus a few supporting tables marked "support".
-- Money is integers only: USDC in 6-decimal base units, INR in paise. Dates of purchase are dates, never times.
-- The two uniqueness rules on purchases and reviews make "one review per purchase" true off-chain too.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- Config ---------------------------------------------------------------------------------------------------------

CREATE TABLE cities (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  bbox        double precision[] NOT NULL,          -- [minLng, minLat, maxLng, maxLat]
  center      geography(Point, 4326) NOT NULL,
  timezone    text NOT NULL,
  languages   text[] NOT NULL,
  currency    text NOT NULL DEFAULT 'INR',
  thresholds  jsonb NOT NULL DEFAULT '{}',
  localities  jsonb NOT NULL DEFAULT '[]',
  status      text NOT NULL DEFAULT 'planned'
);

CREATE TABLE categories (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  rails          text[] NOT NULL,
  aspects        text[] NOT NULL,
  followups      text[] NOT NULL,
  rules          jsonb NOT NULL,                     -- the full CategoryConfig
  category_mean  double precision NOT NULL DEFAULT 3.8
);

-- Identity -------------------------------------------------------------------------------------------------------

-- No names, numbers or photos. Only the nullifier hash, document type, verification time and wallet.
CREATE TABLE reviewers (
  id              text PRIMARY KEY,                  -- on-chain reviewerId (bytes32 hex)
  nullifier_hash  text UNIQUE NOT NULL,
  id_type         text NOT NULL,                     -- self_passport | self_aadhaar | self_eu_id | anon_aadhaar | mock | simulated
  wallet          text UNIQUE NOT NULL,              -- lowercase
  reliability     double precision NOT NULL DEFAULT 0.5,
  scored_reviews  integer NOT NULL DEFAULT 0,
  penalty         double precision NOT NULL DEFAULT 1,
  level           integer NOT NULL DEFAULT 0,
  registry_tx     text,
  simulated       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- support: sign-in nonces for wallet sessions
CREATE TABLE auth_nonces (
  nonce       text PRIMARY KEY,
  used        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Brand registry -------------------------------------------------------------------------------------------------

CREATE TABLE brands (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  grp           text NOT NULL,
  domains       text[] NOT NULL DEFAULT '{}',
  categories    text[] NOT NULL DEFAULT '{}',
  default_rail  text NOT NULL
);

CREATE TABLE brand_rails (
  brand_id           text NOT NULL REFERENCES brands(id),
  rail               text NOT NULL,
  provider_id        text,
  blueprint          text,
  network            text,
  campaign_id        text,
  incentive_allowed  boolean,
  deeplink_template  text,
  status             text NOT NULL,
  notes              text,
  last_tested_at     timestamptz,
  PRIMARY KEY (brand_id, rail)
);

-- Places ---------------------------------------------------------------------------------------------------------

CREATE TABLE merchants (
  id                text PRIMARY KEY,                -- bytes32 hex from merchantIdFor
  brand_id          text NOT NULL REFERENCES brands(id),
  city_id           text REFERENCES cities(id),
  category_id       text REFERENCES categories(id),
  name              text NOT NULL,
  external_id       text,
  upi_vpa           text,
  wallet            text,                            -- payee for on-chain payments (rail 6)
  address           text,
  geom              geography(Point, 4326),
  source            text NOT NULL,                   -- osm | proof | dashboard | demo
  osm_id            text,
  claimed_by        text,                            -- merchant_accounts.id
  receipt_share     double precision,                -- share of its orders that came with QR receipts
  score             double precision,
  score_weight      double precision,
  verified_reviews  integer NOT NULL DEFAULT 0,
  durability        double precision,
  simulated         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchants_geom ON merchants USING gist (geom);
CREATE INDEX merchants_upi ON merchants (upi_vpa);
CREATE INDEX merchants_city ON merchants (city_id);

-- A dish, product variant, room type, service or building.
CREATE TABLE items (
  id                   text PRIMARY KEY,             -- on-chain itemId (bytes32 hex)
  merchant_id          text NOT NULL REFERENCES merchants(id),
  category_id          text NOT NULL REFERENCES categories(id),
  canonical_name       text NOT NULL,
  variant              text,
  embedding            vector(256),
  price_band           text,
  diet                 text,
  price_min_minor      bigint,
  price_max_minor      bigint,
  score                double precision,
  score_weight         double precision,
  verified_reviews     integer NOT NULL DEFAULT 0,
  durability           double precision,
  still_good_next_day  double precision,
  ranked               boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_merchant ON items (merchant_id);
CREATE INDEX items_embedding ON items USING hnsw (embedding vector_cosine_ops);

-- Landlord reviews publish at building level.
CREATE TABLE properties (
  id           text PRIMARY KEY,
  merchant_id  text NOT NULL REFERENCES merchants(id),
  building     text NOT NULL,
  area         text,
  geom         geography(Point, 4326)
);

-- Purchases and proofs -------------------------------------------------------------------------------------------

CREATE TABLE purchases (
  id                  text PRIMARY KEY,
  purchase_nullifier  text UNIQUE NOT NULL,
  reviewer_id         text REFERENCES reviewers(id),
  wallet              text NOT NULL,
  rail                text NOT NULL,
  tier                text NOT NULL,
  brand_id            text NOT NULL REFERENCES brands(id),
  merchant_id         text NOT NULL REFERENCES merchants(id),
  category_id         text REFERENCES categories(id),
  item_ids            text[] NOT NULL DEFAULT '{}',
  items               jsonb NOT NULL DEFAULT '[]',
  amount_minor        bigint NOT NULL,
  currency            text NOT NULL,
  purchased_on        date NOT NULL,
  proof_hash          text NOT NULL,
  proof_cid           text,
  status              text NOT NULL,                 -- confirmed | pending | cancelled
  simulated           boolean NOT NULL DEFAULT false,
  meta                jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- One meal cannot be reviewed once by email and again by UPI: same human, merchant, day and amount.
CREATE UNIQUE INDEX purchases_same_day ON purchases (reviewer_id, merchant_id, purchased_on, amount_minor)
  WHERE status <> 'cancelled' AND reviewer_id IS NOT NULL;
CREATE INDEX purchases_wallet ON purchases (wallet);

-- support: an in-flight proof on any rail, bound to the session wallet
CREATE TABLE proof_requests (
  id           text PRIMARY KEY,
  wallet       text NOT NULL,
  rail         text NOT NULL,
  brand_id     text,
  provider_id  text,
  status       text NOT NULL,                        -- pending | verified | failed
  purchase_id  text REFERENCES purchases(id),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- support: content-addressed store (review JSON, encrypted proof blobs); mirrored to IPFS when a pinning key is set
CREATE TABLE content (
  cid           text PRIMARY KEY,
  bytes         bytea NOT NULL,
  content_type  text NOT NULL,
  pinned        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- support: encrypted voice notes, deleted after 7 days
CREATE TABLE audio_objects (
  id            text PRIMARY KEY,
  wallet        text NOT NULL,
  mime          text NOT NULL,
  byte_length   integer NOT NULL,
  ciphertext    bytea,
  delete_after  timestamptz NOT NULL,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Reviews --------------------------------------------------------------------------------------------------------

-- support: a review being recorded, structured and signed
CREATE TABLE review_drafts (
  id           text PRIMARY KEY,
  purchase_id  text NOT NULL REFERENCES purchases(id),
  wallet       text NOT NULL,
  reviewer_id  text REFERENCES reviewers(id),
  item_id      text REFERENCES items(id),
  audio_id     text REFERENCES audio_objects(id),
  transcript   text,
  language     text,
  structured   jsonb,
  document     jsonb,
  content_cid  text,
  typed_data   jsonb,
  status       text NOT NULL,                        -- open | structured | ready | published | held | failed
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id             text PRIMARY KEY,
  eas_uid        text UNIQUE,
  chain_id       integer,
  tx_hash        text,
  reviewer_id    text NOT NULL REFERENCES reviewers(id),
  purchase_id    text UNIQUE NOT NULL REFERENCES purchases(id),
  item_id        text NOT NULL REFERENCES items(id),
  merchant_id    text NOT NULL REFERENCES merchants(id),
  category_id    text NOT NULL REFERENCES categories(id),
  rating         integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  aspects        jsonb NOT NULL DEFAULT '{}',
  claims         jsonb NOT NULL DEFAULT '[]',
  summary_en     text,
  diet           text,
  language       text,
  content_cid    text NOT NULL,
  rail           text NOT NULL,
  tier           text NOT NULL,
  status         text NOT NULL DEFAULT 'active',     -- active | superseded | held | hidden | cancelled
  publish_at     timestamptz NOT NULL DEFAULT now(),
  trust_weight   double precision NOT NULL DEFAULT 0.5,
  consensus      double precision,
  accuracy       double precision,
  embedding      vector(256),
  hidden_reason  text,
  simulated      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- One active rating per person per item: publishing a newer review supersedes the older one.
CREATE UNIQUE INDEX reviews_one_active ON reviews (reviewer_id, item_id) WHERE status = 'active';
CREATE INDEX reviews_item ON reviews (item_id);
CREATE INDEX reviews_merchant ON reviews (merchant_id);

CREATE TABLE followups (
  id           text PRIMARY KEY,
  review_id    text NOT NULL REFERENCES reviews(id),
  kind         text NOT NULL,                        -- 1d, 7d, 30d, 90d, 180d, trip_end, move_out, return_window, renewal
  day_offset   integer,
  due_at       timestamptz NOT NULL,
  window_end   timestamptz,
  status       text NOT NULL DEFAULT 'scheduled',    -- scheduled | notified | answered | expired
  still_good   boolean,
  new_rating   integer,
  note         text,
  content_cid  text,
  eas_uid      text,
  tx_hash      text,
  notified_at  timestamptz,
  answered_at  timestamptz,
  simulated    boolean NOT NULL DEFAULT false
);
CREATE INDEX followups_due ON followups (status, due_at);
CREATE INDEX followups_review ON followups (review_id);

-- Agent answers and money ----------------------------------------------------------------------------------------

CREATE TABLE answers (
  id               text PRIMARY KEY,
  agent_wallet     text,
  api_key_id       text,
  tool             text NOT NULL,
  query            text NOT NULL,
  category         text,
  filters          jsonb NOT NULL DEFAULT '{}',
  response         jsonb NOT NULL,
  price_usdc       bigint NOT NULL,                  -- base units
  payment_method   text NOT NULL,                    -- x402 | credits | free | cache
  payment_network  text,
  payment_tx       text,
  accrued          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX answers_agent_day ON answers (agent_wallet, created_at);

-- What payouts read: which reviews each paid answer cited, with what weight.
CREATE TABLE citations (
  answer_id  text NOT NULL REFERENCES answers(id),
  review_id  text NOT NULL REFERENCES reviews(id),
  weight     double precision NOT NULL,
  PRIMARY KEY (answer_id, review_id)
);

CREATE TABLE epochs (
  id                text PRIMARY KEY,
  number            integer UNIQUE NOT NULL,
  merkle_root       text,
  total_usdc        bigint NOT NULL,                 -- new money in this epoch
  total_cumulative  bigint NOT NULL,                 -- everything ever owed under this root
  tree              jsonb,                           -- StandardMerkleTree dump, for proofs
  chain_id          integer,
  tx_hash           text,
  status            text NOT NULL,                   -- built | posted | failed
  error             text,
  posted_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger (
  id             text PRIMARY KEY,
  reviewer_id    text NOT NULL REFERENCES reviewers(id),
  source         text NOT NULL,                      -- x402 | card | commission | bonus
  answer_id      text REFERENCES answers(id),
  conversion_id  text,
  amount         bigint NOT NULL,                    -- USDC base units
  currency       text NOT NULL DEFAULT 'USDC',
  epoch_id       text REFERENCES epochs(id),
  status         text NOT NULL DEFAULT 'accrued',    -- accrued | capped | settled
  day            date NOT NULL DEFAULT CURRENT_DATE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_reviewer ON ledger (reviewer_id, status);

CREATE TABLE payout_methods (
  reviewer_id  text PRIMARY KEY REFERENCES reviewers(id),
  kind         text NOT NULL,                        -- usdc | upi
  address      text NOT NULL,                        -- wallet address or UPI ID
  verified_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- support: USDC claims and INR withdrawals actually made
CREATE TABLE payouts (
  id            text PRIMARY KEY,
  reviewer_id   text NOT NULL REFERENCES reviewers(id),
  kind          text NOT NULL,                       -- usdc_claim | inr_upi
  amount_usdc   bigint,
  amount_paise  bigint,
  fx_rate       double precision,
  destination   text,
  provider_ref  text,
  tx_hash       text,
  status        text NOT NULL,                       -- pending | processing | paid | failed
  test_mode     boolean NOT NULL DEFAULT false,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Shop-through ---------------------------------------------------------------------------------------------------

CREATE TABLE affiliate_clicks (
  click_id      text PRIMARY KEY,
  buyer_wallet  text,
  answer_id     text,
  item_id       text,
  merchant_id   text,
  brand_id      text,
  network       text NOT NULL,
  campaign_id   text,
  target_url    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_conversions (
  id                text PRIMARY KEY,
  click_id          text NOT NULL REFERENCES affiliate_clicks(click_id),
  network           text NOT NULL,
  network_order_id  text NOT NULL,
  amount_minor      bigint,
  commission_minor  bigint,
  currency          text NOT NULL DEFAULT 'INR',
  status            text NOT NULL,                   -- pending | confirmed | cancelled
  purchase_id       text REFERENCES purchases(id),
  cashback_paid     boolean NOT NULL DEFAULT false,
  pool_accrued      boolean NOT NULL DEFAULT false,
  test              boolean NOT NULL DEFAULT false,
  raw               jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, network_order_id)
);

-- Merchants ------------------------------------------------------------------------------------------------------

CREATE TABLE merchant_accounts (
  id                    text PRIMARY KEY,
  merchant_id           text UNIQUE NOT NULL REFERENCES merchants(id),
  wallet                text NOT NULL,
  claim_method          text NOT NULL,               -- domain | partner_portal | upi | gst
  evidence_hash         text NOT NULL,
  eas_uid               text,
  plan                  text NOT NULL DEFAULT 'free',
  dodo_customer_id      text,
  dodo_subscription_id  text,
  receipt_signer        text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- support: open claim challenges (the ₹1 UPI reference, the DNS TXT token)
CREATE TABLE merchant_claims (
  id           text PRIMARY KEY,
  merchant_id  text NOT NULL REFERENCES merchants(id),
  wallet       text NOT NULL,
  method       text NOT NULL,
  challenge    text NOT NULL,
  status       text NOT NULL DEFAULT 'open',         -- open | verified | failed
  evidence     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchant_receipts (
  id            text PRIMARY KEY,
  merchant_id   text NOT NULL REFERENCES merchants(id),
  receipt_id    text NOT NULL,
  receipt_hash  text UNIQUE NOT NULL,
  items         jsonb NOT NULL DEFAULT '[]',
  amount_minor  bigint NOT NULL,
  currency      text NOT NULL DEFAULT 'INR',
  issued_at     timestamptz NOT NULL,
  signature     text NOT NULL,
  claimed_by    text,
  claimed_at    timestamptz
);

-- support: public replies, signed and attached to the review on-chain
CREATE TABLE merchant_replies (
  id           text PRIMARY KEY,
  review_id    text NOT NULL REFERENCES reviews(id),
  merchant_id  text NOT NULL REFERENCES merchants(id),
  text         text NOT NULL,
  content_cid  text,
  eas_uid      text,
  tx_hash      text,
  status       text NOT NULL DEFAULT 'published',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Trust ----------------------------------------------------------------------------------------------------------

-- Mirror of the reputation token.
CREATE TABLE credentials (
  reviewer_id  text PRIMARY KEY REFERENCES reviewers(id),
  level        integer NOT NULL,
  token_id     text,
  tx_hash      text,
  eas_uid      text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Written by the trust engine; a human approves penalties.
CREATE TABLE flags (
  id            text PRIMARY KEY,
  signal        text NOT NULL,
  reviewer_ids  text[] NOT NULL DEFAULT '{}',
  merchant_id   text,
  evidence      jsonb NOT NULL DEFAULT '{}',
  case_file     jsonb,
  penalty       double precision,
  status        text NOT NULL DEFAULT 'open',        -- open | confirmed | cleared
  simulated     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  decided_by    text
);

-- support: wallet funding edges for the collusion graph (from on-chain transfers)
CREATE TABLE wallet_funding (
  tx_hash      text NOT NULL,
  from_wallet  text NOT NULL,
  to_wallet    text NOT NULL,
  asset        text NOT NULL,
  amount       text,
  block_time   timestamptz,
  simulated    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tx_hash, to_wallet)
);

-- Billing, notifications, events ---------------------------------------------------------------------------------

-- support: card customers (Dodo) buy API credits
CREATE TABLE api_keys (
  id                text PRIMARY KEY,
  key_hash          text UNIQUE NOT NULL,
  label             text,
  owner_email       text,
  credits_usdc      bigint NOT NULL DEFAULT 0,
  dodo_customer_id  text,
  disabled          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- support: Dodo webhooks and other billing events, idempotent by id
CREATE TABLE billing_events (
  id          text PRIMARY KEY,
  provider    text NOT NULL,
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- support: where to send follow-up check-ins
CREATE TABLE push_targets (
  id           text PRIMARY KEY,
  reviewer_id  text NOT NULL REFERENCES reviewers(id),
  kind         text NOT NULL,                        -- expo | webpush | whatsapp | email
  target       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- support: the stage event log
CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
