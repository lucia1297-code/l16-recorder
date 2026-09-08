const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return Response.json({ error: "OpenAI server key is not configured" }, { status: 503, headers: cors });
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      if (form.get("action") !== "transcribe") return Response.json({ error: "unsupported action" }, { status: 400, headers: cors });
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400, headers: cors });
      const upstream = new FormData();
      upstream.append("file", file, file.name || "recording.webm");
      upstream.append("model", "whisper-1");
      upstream.append("language", String(form.get("language") || "ko"));
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: upstream });
      return new Response(await response.text(), { status: response.status, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const body = await req.json();
    if (body.action !== "analyze" || !Array.isArray(body.messages)) return Response.json({ error: "invalid request" }, { status: 400, headers: cors });
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: body.max_tokens ?? 1500, messages: body.messages }) });
    return new Response(await response.text(), { status: response.status, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return Response.json({ error: "proxy request failed", detail: String(error) }, { status: 500, headers: cors });
  }
});
