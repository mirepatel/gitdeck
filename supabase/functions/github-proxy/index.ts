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

      const [commits, issues, contributors, languages, pkg, community] = await Promise.all([
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
          rateLimit: base.rateLimit,
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
