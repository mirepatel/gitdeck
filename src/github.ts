import type { FetchResult } from './types';

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // URL form: https://github.com/owner/repo
  const urlMatch = trimmed.match(
    /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') };
  }

  // shorthand: owner/repo
  const parts = trimmed.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  }

  return null;
}

const TOKEN_KEY = 'gitdeck_gh_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

// Calls the server-side github-proxy edge function instead of hitting GitHub directly.
export async function fetchRepoData(
  owner: string,
  repo: string
): Promise<FetchResult> {
  try {
    const token = getStoredToken();

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/github-proxy`;
    const params = new URLSearchParams({
      action: 'repo',
      owner,
      repo,
    });
    if (token) params.set('token', token);

    const res = await fetch(`${apiUrl}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        repo: null,
        commits: [],
        issues: [],
        contributors: [],
        languages: {},
        dependencies: { dependencies: {}, devDependencies: {}, hasPackageJson: false },
        community: null,
        release: null,
        error: body?.error ?? `Server error (${res.status}).`,
        rateLimit: body?.rateLimit ?? null,
      };
    }

    const body = (await res.json()) as FetchResult;
    return {
      repo: body.repo,
      commits: body.commits ?? [],
      issues: body.issues ?? [],
      contributors: body.contributors ?? [],
      languages: body.languages ?? {},
      dependencies: body.dependencies ?? { dependencies: {}, devDependencies: {}, hasPackageJson: false },
      community: body.community ?? null,
      release: body.release ?? null,
      error: body.error ?? null,
      rateLimit: body.rateLimit ?? null,
    };
  } catch (e) {
    return {
      repo: null,
      commits: [],
      issues: [],
      contributors: [],
      languages: {},
      dependencies: { dependencies: {}, devDependencies: {}, hasPackageJson: false },
      community: null,
      release: null,
      error: e instanceof Error ? `Network error: ${e.message}` : 'Network error reaching server.',
      rateLimit: null,
    };
  }
}

// Fetches punch card data (day-of-week × hour commit density) from the edge function.
// Returns a 7×24 grid of [day, hour, count] tuples, or empty array on failure.
export async function fetchPunchCard(
  owner: string,
  repo: string
): Promise<{ punchCard: number[][]; error: string | null }> {
  try {
    const token = getStoredToken();
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/github-proxy`;
    const params = new URLSearchParams({
      action: 'punch_card',
      owner,
      repo,
    });
    if (token) params.set('token', token);

    const res = await fetch(`${apiUrl}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      return { punchCard: [], error: `Server error (${res.status}).` };
    }

    const body = await res.json();
    return { punchCard: body.punchCard ?? [], error: null };
  } catch {
    return { punchCard: [], error: 'Network error fetching punch card data.' };
  }
}
