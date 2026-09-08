// Server-side Whisper proxy. The OpenAI key must be configured as an Edge Function secret:
// supabase functions secrets set OPENAI_API_KEY=...
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: { ...cors, "Content-Type": "application/json" } });
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const incoming = await req.formData();
    const file = incoming.get("file");
    if (!(file instanceof File) || file.size === 0) return new Response(JSON.stringify({ error: "file required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const form = new FormData();
    form.append("file", file, file.name || "recording.webm");
    form.append("model", "whisper-1");
    form.append("language", "ko");
    form.append("response_format", "verbose_json");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    const body = await response.json();
    if (response.ok && Array.isArray(body.segments)) {
      const segments = body.segments.filter((segment: { no_speech_prob?: number; avg_logprob?: number }) =>
        (segment.no_speech_prob ?? 0) < 0.65 && (segment.avg_logprob == null || segment.avg_logprob > -1.1));
      return Response.json({ text: segments.map((segment: { text?: string }) => segment.text ?? "").join(" ").trim(), usage: body.usage }, { status: response.status, headers: cors });
    }
    return Response.json(body, { status: response.status, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
