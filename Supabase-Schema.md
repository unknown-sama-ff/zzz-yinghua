# Supabase Schema

Run this SQL in the Supabase Dashboard → SQL Editor to create the gallery table.

```sql
CREATE TABLE gallery (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  image_url TEXT NOT NULL,
  style TEXT NOT NULL,
  character_name TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  provider TEXT DEFAULT ''
);

ALTER TABLE gallery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert"
ON gallery FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "anon_select"
ON gallery FOR SELECT
TO anon
USING (true);

CREATE POLICY "anon_delete"
ON gallery FOR DELETE
TO anon
USING (true);
```

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

No anonymous policies should be added to these payment tables. The Express server is the only writer and reader.

## Storage

- Bucket name: `gallery-images`
- Bucket type: public
- `gallery.image_url` should store the Supabase Storage public URL, not a `data:image/...` base64 string.

Anonymous upload/delete/read policies on `storage.objects` should allow access to the `gallery-images` bucket.
