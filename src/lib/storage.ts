import { supabase } from './supabase';
import type { FetchResult } from '../types';

export interface ArchivedReport {
  id: string;
  repo_full_name: string;
  storage_path: string;
  file_name: string;
  health_score: number | null;
  created_at: string;
}

export async function listArchivedReports(): Promise<ArchivedReport[]> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.access_token) return [];

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gitdeck-audits?action=list`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.session.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) return [];
  const body = await res.json();
  return (body.reports ?? []) as ArchivedReport[];
}

export async function archiveAuditReport(
  data: FetchResult,
  markdown: string
): Promise<{ success: boolean; error: string | null }> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.access_token || !data.repo) {
    return { success: false, error: 'Sign in to save audit reports.' };
  }

  const fileName = `${data.repo.full_name.replace('/', '-')}-audit.md`;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gitdeck-audits`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repoFullName: data.repo.full_name,
      markdown,
      fileName,
      healthScore: null,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { success: false, error: body?.error ?? 'Failed to save report.' };
  }
  return { success: true, error: null };
}

export async function downloadArchivedReport(path: string): Promise<string | null> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.access_token) return null;

  const url = `${
    import.meta.env.VITE_SUPABASE_URL
  }/functions/v1/gitdeck-audits?action=download&path=${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.session.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) return null;
  return res.text();
}
