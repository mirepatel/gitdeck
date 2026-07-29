import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ArchiveBody {
  repoFullName: string;
  markdown: string;
  fileName: string;
  healthScore: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Authenticate the caller via the JWT passed in the Authorization header
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData.user) {
      return new Response(
        JSON.stringify({ error: "Authentication required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userData.user.id;

    const url = new URL(req.url);
    const method = req.method;

    // POST → save a new audit report to Storage + insert metadata row
    if (method === "POST") {
      const body = (await req.json()) as ArchiveBody;
      if (!body?.repoFullName || !body?.markdown || !body?.fileName) {
        return new Response(
          JSON.stringify({ error: "Missing required fields." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const storagePath = `${userId}/${body.fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("gitdeck-audits")
        .upload(storagePath, body.markdown, {
          contentType: "text/markdown",
          upsert: true,
        });

      if (uploadError) {
        return new Response(
          JSON.stringify({ error: `Storage upload failed: ${uploadError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: dbError } = await supabase.from("audit_reports").insert({
        user_id: userId,
        repo_full_name: body.repoFullName,
        storage_path: storagePath,
        file_name: body.fileName,
        health_score: body.healthScore ?? null,
      });

      if (dbError) {
        return new Response(
          JSON.stringify({ error: `Database insert failed: ${dbError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, storagePath }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET → list the user's archived audit reports
    if (method === "GET" && url.searchParams.get("action") === "list") {
      const { data, error } = await supabase
        .from("audit_reports")
        .select("id, repo_full_name, storage_path, file_name, health_score, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ reports: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET → download a specific archived report (returns the markdown text)
    if (method === "GET" && url.searchParams.get("action") === "download") {
      const path = url.searchParams.get("path");
      if (!path || !path.startsWith(`${userId}/`)) {
        return new Response(
          JSON.stringify({ error: "Invalid or unauthorized path." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabase.storage
        .from("gitdeck-audits")
        .download(path);

      if (error || !data) {
        return new Response(
          JSON.stringify({ error: "File not found." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const text = await data.text();
      return new Response(text, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/markdown" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unsupported method/action combination.` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
