// Server-side GPT proxy. The OpenAI key must be configured as an Edge Function secret.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const system = `당신은 수능 영어 전문 강사(30년 경력)의 수업 분석 보조 AI입니다.
수업 녹음 텍스트를 분석하여 다음 형식으로 작성하세요:

【이해도 분석】
• 학생이 이해한 개념 / 이해하지 못한 부분

【반응 및 참여도】
• 질문 빈도, 반응 속도, 집중도

【취약 영역】
• 반복적으로 틀리거나 막히는 유형

【강점】
• 잘 따라오는 영역

【다음 수업 지도 방향】
• 구체적인 지도 제안 (유형별)

전문적이고 간결하게 작성하세요.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: { ...cors, "Content-Type": "application/json" } });
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const payload = await req.json();
    const studentName = String(payload.studentName ?? "학생");
    const transcript = String(payload.transcript ?? "").trim();
    if (!transcript) return new Response(JSON.stringify({ error: "transcript required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const trimmed = transcript.length > 8000 ? transcript.slice(0, 8000) + "\n...(이하 생략)" : transcript;
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1500, messages: [{ role: "system", content: system }, { role: "user", content: `${studentName} 학생 수업 녹음입니다:\n\n${trimmed}` }] }) });
    const data = await response.json();
    if (!response.ok) return new Response(JSON.stringify({ error: data.error?.message ?? `OpenAI HTTP ${response.status}` }), { status: response.status, headers: { ...cors, "Content-Type": "application/json" } });
    const analysis = data.choices?.[0]?.message?.content ?? "분석 결과를 가져오지 못했습니다.";
    const keywords = (analysis.match(/【([^】]+)】/g) ?? []).map((k: string) => k.replace(/【|】/g, ""));
    return new Response(JSON.stringify({ analysis, keywords }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
