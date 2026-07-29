/*
# GitDeck: bookmarks, audit_reports tables + storage bucket

## Overview
Upgrades GitDeck from a client-only tool to a full-stack SaaS. Adds two owner-scoped
tables for signed-in users plus a private Storage bucket for archived audit reports.

## 1. New Tables

### bookmarks
Stores a user's saved GitHub repositories for quick access.
- id            uuid PK
- user_id       uuid NOT NULL, defaults to the authenticated user, cascading on delete
- repo_full_name text NOT NULL  (e.g. "facebook/react")
- created_at    timestamptz default now()
- Unique constraint on (user_id, repo_full_name) prevents duplicate bookmarks.

### audit_reports
Metadata for every audit report a user generates and archives to Storage.
- id            uuid PK
- user_id       uuid NOT NULL, defaults to the authenticated user, cascading on delete
- repo_full_name text NOT NULL  (e.g. "facebook/react")
- storage_path  text NOT NULL   (path inside the gitdeck-audits bucket)
- file_name     text NOT NULL   (download-friendly file name)
- health_score  integer         (0-100 snapshot at generation time, nullable)
- created_at    timestamptz default now()

## 2. Indexes
- bookmarks(user_id) for listing a user's bookmarks.
- audit_reports(user_id) for listing a user's archived reports.

## 3. Storage
- Private bucket "gitdeck-audits" for archived Markdown audit reports.
- Storage policies allow authenticated users to manage only objects under their
  own user-id prefix.

## 4. Security (RLS)
Both tables are owner-scoped (multi-user app with sign-in). RLS enabled on both.
Four CRUD policies per table, scoped TO authenticated with auth.uid() = user_id.
Owner columns default to auth.uid() so client inserts omitting user_id succeed.
*/

-- bookmarks
CREATE TABLE IF NOT EXISTS bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  repo_full_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, repo_full_name)
);

ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_bookmarks" ON bookmarks;
CREATE POLICY "select_own_bookmarks" ON bookmarks FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_bookmarks" ON bookmarks
;
CREATE POLICY "insert_own_bookmarks" ON bookmarks FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_bookmarks" ON bookmarks;
CREATE POLICY "update_own_bookmarks" ON bookmarks FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_bookmarks" ON bookmarks;
CREATE POLICY "delete_own_bookmarks" ON bookmarks FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);

-- audit_reports
CREATE TABLE IF NOT EXISTS audit_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  repo_full_name text NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  health_score integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_audit_reports" ON audit_reports;
CREATE POLICY "select_own_audit_reports" ON audit_reports FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_audit_reports" ON audit_reports;
CREATE POLICY "insert_own_audit_reports" ON audit_reports FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_audit_reports" ON audit_reports;
CREATE POLICY "update_own_audit_reports" ON audit_reports FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_audit_reports" ON audit_reports;
CREATE POLICY "delete_own_audit_reports" ON audit_reports FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_audit_reports_user_id ON audit_reports(user_id);

-- Storage bucket for audit report archives
INSERT INTO storage.buckets (id, name, public)
VALUES ('gitdeck-audits', 'gitdeck-audits', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: users manage only their own prefix ({user_id}/...)
DROP POLICY IF EXISTS "read_own_audit_files" ON storage.objects;
CREATE POLICY "read_own_audit_files" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'gitdeck-audits' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "write_own_audit_files" ON storage.objects;
CREATE POLICY "write_own_audit_files" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'gitdeck-audits' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "update_own_audit_files" ON storage.objects;
CREATE POLICY "update_own_audit_files" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'gitdeck-audits' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "delete_own_audit_files" ON storage.objects;
CREATE POLICY "delete_own_audit_files" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'gitdeck-audits' AND (storage.foldername(name))[1] = auth.uid()::text);
