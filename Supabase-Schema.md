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

## Storage

- Bucket name: `gallery-images`
- Bucket type: public
- `gallery.image_url` should store the Supabase Storage public URL, not a `data:image/...` base64 string.

Anonymous upload/delete/read policies on `storage.objects` should allow access to the `gallery-images` bucket.
