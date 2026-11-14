import { useRef, useState } from "react";
import { parseExamFile, detectKind } from "../../lib/examDocParser";
import { extractExamFields, type ExamFields, type ExtractResult } from "../../lib/examFieldExtractor";

interface Props {
  roster: { studentCode: string; name: string }[];
  /** 추출된 값을 폼 칸에 채운다 */
  onApply: (fields: Partial<ExamFields>, fileName: string, matchedStudentCodes: string[]) => void;
}

const ACCEPT = ".png,.jpg,.jpeg,.webp,.bmp,.heic,.pdf,.txt,.csv,.md,.docx,.hwp,.hwpx,.xlsx,.xls,image/*";

export default function ExamMaterialDropzone({ roster, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ file: string; method: string; r: ExtractResult; text: string } | null>(null);
  const [showText, setShowText] = useState(false);

  async function handleFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length || busy) return;
    setBusy(true); setError(""); setResult(null); setShowText(false);
    try {
      // 여러 파일이면 모두 읽어 합쳐서 분석한다(예: 시험범위표 + 시간표 사진)
      const texts: string[] = [];
      const methods: string[] = [];
      for (const f of files) {
        if (detectKind(f) === "unknown") throw new Error(`지원하지 않는 형식입니다: ${f.name}`);
        setStatus(`${f.name} 읽는 중…`);
        const doc = await parseExamFile(f, setStatus);
        texts.push(doc.text);
        methods.push(doc.method);
      }
      const text = texts.join("\n");
      if (text.replace(/\s/g, "").length < 5) {
        throw new Error("글자를 읽지 못했습니다. 더 선명한 사진이나 다른 형식으로 다시 올려주세요.");
      }
      const name = files.map(f => f.name).join(", ");
      const r = extractExamFields(text, { fileName: files[0].name, roster });
      setResult({ file: name, method: [...new Set(methods)].join(" + "), r, text });
      if (r.hits.length) onApply(r.fields, name, r.matchedStudentCodes);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false); setStatus("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        role="button"
        tabIndex={0}
        aria-label="시험 자료 파일 올리기"
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        style={{
          border: `2px dashed ${drag ? "#7c3aed" : "#c4b5fd"}`, background: drag ? "#f5f3ff" : "#faf8ff",
          borderRadius: 10, padding: "14px 12px", textAlign: "center", cursor: busy ? "wait" : "pointer",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#6d28d9" }}>
          {busy ? "⏳ 자료 분석 중…" : "📎 시험 자료 올리기"}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
          {busy ? status : "파일을 끌어놓거나 눌러서 선택 · 이미지 / PDF / TXT / DOCX / HWP / HWPX / 엑셀"}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          일정·범위를 읽어 아래 칸에 자동으로 입력합니다 (저장 전에 직접 수정할 수 있어요)
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden
          onChange={e => handleFiles(e.target.files)} />
      </div>

      {error && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 12 }}>
          ⚠️ {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: 12 }}>
          {result.r.hits.length ? (
            <>
              <div style={{ fontWeight: 700, color: "#166534", marginBottom: 4 }}>
                ✅ {result.r.hits.length}개 칸에 입력했습니다 <span style={{ fontWeight: 400, color: "#64748b" }}>({result.method})</span>
              </div>
              {result.r.hits.map(h => (
                <div key={h.field} style={{ color: "#334155", lineHeight: 1.6 }}>
                  <b>{h.label}</b> → {h.value.length > 60 ? h.value.slice(0, 60) + "…" : h.value}
                  <span style={{ color: "#94a3b8" }}> · 근거: {h.evidence}</span>
                </div>
              ))}
              <div style={{ color: "#64748b", marginTop: 4 }}>찾지 못한 칸은 비워 두었습니다. 내용이 맞는지 확인해 주세요.</div>
            </>
          ) : (
            <div style={{ color: "#92400e" }}>
              📄 글자는 읽었지만 일정·범위로 보이는 정보를 찾지 못했습니다. 아래 읽은 내용을 확인하고 직접 입력해 주세요.
            </div>
          )}
          <button type="button" onClick={() => setShowText(s => !s)}
            style={{ marginTop: 6, background: "none", border: "none", color: "#6d28d9", fontSize: 12, cursor: "pointer", padding: 0 }}>
            {showText ? "읽은 원문 숨기기 ▲" : "읽은 원문 보기 ▼"}
          </button>
          {showText && (
            <pre style={{ marginTop: 6, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, fontSize: 11 }}>
              {result.text.slice(0, 6000)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
