# Supabase Schema

Run this SQL in the Supabase Dashboard → SQL Editor to create the gallery table.

```sql
CREATE TABLE gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  image_url TEXT NOT NULL,
  style TEXT NOT NULL,
  character_name TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  provider TEXT DEFAULT '',
  delete_token_hash TEXT DEFAULT ''      -- SHA-256 of the uploader's delete token
);
```

> `id` may be `UUID` (above) or `BIGINT IDENTITY` — the server's delete endpoint
> accepts both id shapes.

ALTER TABLE gallery ENABLE ROW LEVEL SECURITY;

-- Public read only. Inserts/deletes go through the Express server (service-role
-- key) so anonymous visitors can't wipe the gallery or spam rows.
-- Column-level privileges restrict what the browser's anon key can read:
-- `delete_token_hash` (the SHA-256 of the deletion capability) must NEVER be
-- queryable by the anon client, so it can't be attacked offline.
REVOKE SELECT ON gallery FROM anon;
GRANT SELECT (id, created_at, image_url, style, character_name, prompt, provider) ON gallery TO anon;

CREATE POLICY "anon_select"
ON gallery FOR SELECT
TO anon
USING (true);
```

> **Existing databases** — migrate away from the old permissive policies:
>
> ```sql
> ALTER TABLE gallery ADD COLUMN IF NOT EXISTS delete_token_hash TEXT DEFAULT '';
> DROP POLICY IF EXISTS "anon_insert" ON gallery;
> DROP POLICY IF EXISTS "anon_delete" ON gallery;
> -- restrict the anon key to display columns (run after any existing GRANT ALL)
> REVOKE SELECT ON gallery FROM anon;
> GRANT SELECT (id, created_at, image_url, style, character_name, prompt, provider) ON gallery TO anon;
> ```

## Server-side sponsorship payments

Run this SQL in the Supabase Dashboard for the Express server. Do not expose these tables through the anonymous browser client; the server uses `SUPABASE_SERVICE_ROLE_KEY`.

```sql
CREATE TABLE sponsor_orders (
  order_no TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 10000000),
  amount_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'closed', 'refunded')),
  visitor_token_hash TEXT NOT NULL,
  client_idempotency_key TEXT NOT NULL,
  trade_no TEXT,
  sponsor_name TEXT NOT NULL DEFAULT 'Traveler',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  UNIQUE (visitor_token_hash, client_idempotency_key),
  UNIQUE (trade_no)
);

CREATE INDEX sponsor_orders_visitor_idx ON sponsor_orders (visitor_token_hash, created_at DESC);

CREATE TABLE payment_notify_events (
  notify_key TEXT PRIMARY KEY,
  notify_id TEXT,
  trade_no TEXT,
  order_no TEXT NOT NULL REFERENCES sponsor_orders(order_no),
  trade_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sponsor_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_notify_events ENABLE ROW LEVEL SECURITY;
```

`sponsor_name` is user-supplied (capped at 20 chars server-side, default `'Traveler'`).

For tables already created before the `sponsor_name` column existed, run this migration in the Supabase Dashboard (idempotent; the constant default auto-backfills existing rows):

```sql
ALTER TABLE sponsor_orders
  ADD COLUMN IF NOT EXISTS sponsor_name TEXT NOT NULL DEFAULT 'Traveler';

CREATE INDEX IF NOT EXISTS sponsor_orders_paid_idx
  ON sponsor_orders (paid_at DESC)
  WHERE status = 'paid';
```

No anonymous policies should be added to these payment tables. The Express server is the only writer and reader.

## WeChat Pay channel migration

Adds a payment-channel column plus an openid-based identity so mini program
orders (WeChat Pay) can live in the same `sponsor_orders` table as web orders
(Alipay). Pure additive — existing rows keep their Alipay identity.

```sql
-- sponsor_orders: which payment channel owns the order
ALTER TABLE sponsor_orders
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'alipay';

-- openid identity for mini program orders (hashed sha256, never the raw openid)
ALTER TABLE sponsor_orders
  ADD COLUMN IF NOT EXISTS openid_hash TEXT;

-- web orders still key off the visitor token; mini program orders use openid
ALTER TABLE sponsor_orders
  ALTER COLUMN visitor_token_hash DROP NOT NULL;

-- idempotency for mini program orders, parallel to the visitor unique index
CREATE UNIQUE INDEX IF NOT EXISTS sponsor_orders_openid_idem_idx
  ON sponsor_orders (openid_hash, client_idempotency_key)
  WHERE openid_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS sponsor_orders_openid_idx
  ON sponsor_orders (openid_hash, created_at DESC);

-- dedupe WeChat notify events in the same table as Alipay events
ALTER TABLE payment_notify_events
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'alipay';
```

## Storage

- Bucket name: `gallery-images`
- Bucket type: public
- `gallery.image_url` should store the Supabase Storage public URL, not a `data:image/...` base64 string.
- Uploads and object deletes are done by the Express server (service-role key). **Do not** add anonymous upload/delete policies to `storage.objects` — the anon key must be read-only for the bucket.

## Server prerequisites

Gallery saves/deletes and sponsorship payments need the Express server env vars:
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the service-role key never reaches the browser; the client only sees `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
