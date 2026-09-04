import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GITHUB_API = "https://api.github.com";

interface RateLimit {
  remaining: number;
  limit: number;
  reset: number;
}

async function ghFetch<T>(
  path: string,
  token: string | null
): Promise<{
  data: T | null;
  error: string | null;
  rateLimit: RateLimit | null;
  status: number;
}> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${GITHUB_API}${path}`, { headers });

    const rateLimit: RateLimit = {
      remaining: Number(res.headers.get("X-RateLimit-Remaining") ?? 0),
      limit: Number(res.headers.get("X-RateLimit-Limit") ?? 0),
      reset: Number(res.headers.get("X-RateLimit-Reset") ?? 0),
    };

    if (res.status === 403 && rateLimit.remaining === 0) {
      return {
        data: null,
        error: `GitHub API rate limit reached. Resets at ${new Date(
          rateLimit.reset * 1000
        ).toLocaleTimeString()}.`,
        rateLimit,
        status: 403,
      };
    }

    if (res.status === 404) {
      return {
        data: null,
        error: "Repository not found or is private.",
        rateLimit,
        status: 404,
      };
    }

    if (!res.ok) {
      let msg = `GitHub API error (${res.status}).`;
      try {
        const body = await res.json();
        if (body?.message) msg = body.message;
      } catch {
        /* ignore */
      }
      return { data: null, error: msg, rateLimit, status: res.status };
    }

    const data = (await res.json()) as T;
    return { data, error: null, rateLimit, status: res.status };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? `Network error: ${e.message}` : "Network error reaching GitHub.",
      rateLimit: null,
      status: 0,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "repo";

    // GET /functions/v1/github-proxy?owner=facebook&repo=react
    if (action === "repo") {
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) {
        return new Response(
          JSON.stringify({ error: "Missing owner or repo parameters." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Token priority: client-supplied query param → server env var fallback
      const clientToken = url.searchParams.get("token");
      const envToken = Deno.env.get("GITHUB_TOKEN") ?? null;
      const token = clientToken || envToken;

      const base = await ghFetch<unknown>(`/repos/${owner}/${repo}`, token);
      if (base.error) {
        return new Response(
          JSON.stringify({ error: base.error, rateLimit: base.rateLimit }),
          { status: base.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const [commits, issues, contributors, languages, pkg, community, release] = await Promise.all([
        ghFetch<unknown[]>(`/repos/${owner}/${repo}/commits?per_page=100`, token),
        ghFetch<unknown[]>(`/repos/${owner}/${repo}/issues?state=all&per_page=100`, token),
        ghFetch<unknown[]>(`/repos/${owner}/${repo}/contributors?per_page=100&anon=true`, token),
        ghFetch<Record<string, number>>(`/repos/${owner}/${repo}/languages`, token),
        ghFetch<{ content?: string; encoding?: string }>(`/repos/${owner}/${repo}/contents/package.json`, token),
        ghFetch<{
          health_percentage: number;
          files: {
            code_of_conduct: boolean | null;
            contributing: boolean | null;
            issue_template: boolean | null;
            pull_request_template: boolean | null;
            license: boolean | null;
            readme: boolean | null;
          };
        }>(`/repos/${owner}/${repo}/community/profile`, token),
        ghFetch<{ tag_name: string; html_url: string; published_at: string; name: string | null }>(
          `/repos/${owner}/${repo}/releases/latest`,
          token
        ),
      ]);
      let dependencies = { dependencies: {}, devDependencies: {}, hasPackageJson: false };
      if (pkg.data?.content) {
        try {
          const decoded = atob(pkg.data.content.replace(/\n/g, ""));
          const parsed = JSON.parse(decoded);
          dependencies = {
            dependencies: typeof parsed.dependencies === "object" && parsed.dependencies ? parsed.dependencies : {},
            devDependencies: typeof parsed.devDependencies === "object" && parsed.devDependencies ? parsed.devDependencies : {},
            hasPackageJson: true,
          };
        } catch {
          /* malformed package.json — leave empty */
        }
      }

      return new Response(
        JSON.stringify({
          repo: base.data,
          commits: commits.data ?? [],
          issues: issues.data ?? [],
          contributors: contributors.data ?? [],
          languages: languages.data ?? {},
          dependencies,
          community: community.data ?? null,
          release: release.status === 404 ? null : release.data ?? null,
          rateLimit: base.rateLimit,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET /functions/v1/github-proxy?action=punch_card&owner=facebook&repo=react
    if (action === "punch_card") {
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) {
        return new Response(
          JSON.stringify({ error: "Missing owner or repo parameters." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientToken = url.searchParams.get("token");
      const envToken = Deno.env.get("GITHUB_TOKEN") ?? null;
      const token = clientToken || envToken;

      // GitHub punch card returns [dayOfWeek, hour, commitCount] tuples
      const punch = await ghFetch<number[][]>(
        `/repos/${owner}/${repo}/stats/punch_card`,
        token
      );

      // If stats endpoint returns 202 (generating) or empty, fall back to
      // aggregating commit timestamps by day-of-week and hour.
      let punchData = punch.data;
      let lastRateLimit = punch.rateLimit;

      if (!punchData || punchData.length === 0) {
        const commitsRes = await ghFetch<Array<{ commit: { author: { date: string } } }>>(
          `/repos/${owner}/${repo}/commits?per_page=100`,
          token
        );
        lastRateLimit = commitsRes.rateLimit ?? punch.rateLimit;
        const commits = commitsRes.data ?? [];
        if (commits.length > 0) {
          const grid: number[][] = [];
          for (let d = 0; d < 7; d++) {
            for (let h = 0; h < 24; h++) {
              grid.push([d, h, 0]);
            }
          }
          const lookup = new Map<string, number>();
          grid.forEach((cell, i) => lookup.set(`${cell[0]}-${cell[1]}`, i));

          commits.forEach((c) => {
            const date = new Date(c.commit.author.date);
            const day = date.getDay();
            const hour = date.getHours();
            const idx = lookup.get(`${day}-${hour}`);
            if (idx !== undefined) grid[idx][2]++;
          });
          punchData = grid;
        }
      }

      return new Response(
        JSON.stringify({
          punchCard: punchData ?? [],
          rateLimit: lastRateLimit,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET /functions/v1/github-proxy?action=code_frequency&owner=facebook&repo=react
    if (action === "code_frequency") {
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) {
        return new Response(
          JSON.stringify({ error: "Missing owner or repo parameters." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientToken = url.searchParams.get("token");
      const envToken = Deno.env.get("GITHUB_TOKEN") ?? null;
      const token = clientToken || envToken;

      // GitHub code_frequency returns [timestamp, additions, deletions] weekly tuples.
      // deletions are negative numbers. The endpoint may return 202 while generating.
      const freq = await ghFetch<number[][]>(
        `/repos/${owner}/${repo}/stats/code_frequency`,
        token
      );

      return new Response(
        JSON.stringify({
          codeFrequency: freq.data ?? [],
          rateLimit: freq.rateLimit,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET /functions/v1/github-proxy?action=closed_prs&owner=facebook&repo=react
    if (action === "closed_prs") {
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) {
        return new Response(
          JSON.stringify({ error: "Missing owner or repo parameters." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientToken = url.searchParams.get("token");
      const envToken = Deno.env.get("GITHUB_TOKEN") ?? null;
      const token = clientToken || envToken;

      const prs = await ghFetch<Array<{
        number: number;
        title: string;
        html_url: string;
        created_at: string;
        merged_at: string | null;
        closed_at: string | null;
        user: { login: string; avatar_url: string } | null;
      }>>(
        `/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
        token
      );

      return new Response(
        JSON.stringify({
          pullRequests: prs.data ?? [],
          rateLimit: prs.rateLimit,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
