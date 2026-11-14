// 업로드된 시험 자료 파일(이미지, pdf, txt, docx, hwp, hwpx, xlsx…) → 텍스트.
// 전부 브라우저 안에서 처리한다(서버 전송 없음). 무거운 라이브러리는 필요할 때만 동적 import.

export type DocKind = "image" | "pdf" | "text" | "docx" | "hwp" | "hwpx" | "xlsx" | "unknown";

export interface ParsedDoc {
  text: string;
  kind: DocKind;
  method: string; // 사용자에게 보여줄 처리 방식 설명
}

export type ProgressFn = (msg: string) => void;

export function detectKind(file: { name: string; type?: string }): DocKind {
  const n = file.name.toLowerCase();
  const t = file.type ?? "";
  if (t.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|heic|tiff?)$/.test(n)) return "image";
  if (t === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".hwpx")) return "hwpx";
  if (n.endsWith(".hwp")) return "hwp";
  if (/\.(xlsx|xlsm|xls)$/.test(n)) return "xlsx";
  if (/\.(txt|csv|md|text|rtf)$/.test(n) || t.startsWith("text/")) return "text";
  return "unknown";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
}

// ── 텍스트 ───────────────────────────────────────────
export function decodeTextBytes(buf: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try { return new TextDecoder("euc-kr").decode(buf); } catch { return new TextDecoder().decode(buf); }
  }
}

// ── DOCX ────────────────────────────────────────────
export async function docxToText(buf: Uint8Array): Promise<string> {
  const { unzipSync } = await import("fflate");
  const files = unzipSync(buf, { filter: f => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name) });
  const parts: string[] = [];
  for (const name of Object.keys(files).sort()) {
    const xml = new TextDecoder().decode(files[name]);
    parts.push(
      decodeEntities(
        xml
          .replace(/<w:tab\s*\/>/g, "\t")
          .replace(/<w:br\s*\/>/g, "\n")
          .replace(/<\/w:tc>/g, "\t")
          .replace(/<\/w:p>/g, "\n")
          .replace(/<[^>]+>/g, ""),
      ),
    );
  }
  return parts.join("\n");
}

// ── HWPX (zip + XML) ────────────────────────────────
export async function hwpxToText(buf: Uint8Array): Promise<string> {
  const { unzipSync } = await import("fflate");
  const files = unzipSync(buf, { filter: f => /^Contents\/section\d+\.xml$/i.test(f.name) });
  const names = Object.keys(files).sort((a, b) => (parseInt(a.replace(/\D/g, "")) || 0) - (parseInt(b.replace(/\D/g, "")) || 0));
  if (!names.length) throw new Error("HWPX 본문(section)을 찾지 못했습니다");
  const out: string[] = [];
  for (const name of names) {
    const xml = new TextDecoder().decode(files[name]);
    const body = xml
      .replace(/<hp:tab\s*\/>/g, "\t")
      .replace(/<hp:lineBreak\s*\/>/g, "\n")
      .replace(/<\/hp:tc>/g, "\t")
      .replace(/<\/hp:p>/g, "\n")
      .replace(/<[^>]+>/g, "");
    out.push(decodeEntities(body));
  }
  return out.join("\n");
}

// ── HWP 5.x (OLE 복합 문서) ─────────────────────────
const HWP_SINGLE_CTRL = new Set([10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

/** BodyText 섹션 하나(압축 해제 후)의 PARA_TEXT 레코드(tag 67)에서 문장을 뽑는다. */
export function hwpSectionToText(data: Uint8Array): string {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const paras: string[] = [];
  let pos = 0;
  while (pos + 4 <= data.length) {
    const h = dv.getUint32(pos, true);
    pos += 4;
    const tag = h & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) {
      if (pos + 4 > data.length) break;
      size = dv.getUint32(pos, true);
      pos += 4;
    }
    if (pos + size > data.length) break;
    if (tag === 67) {
      let s = "";
      for (let i = 0; i + 1 < size; ) {
        const ch = dv.getUint16(pos + i, true);
        if (ch >= 32) { s += String.fromCharCode(ch); i += 2; }
        else if (ch === 9) { s += " "; i += 16; }
        else if (ch === 10) { s += "\n"; i += 2; }
        else if (ch === 13) { i += 2; }
        else if (HWP_SINGLE_CTRL.has(ch) || ch === 0) { i += 2; }
        else { i += 16; } // 확장/인라인 컨트롤(8 WCHAR)
      }
      paras.push(s);
    }
    pos += size;
  }
  return paras.join("\n");
}

export async function hwpToText(buf: Uint8Array): Promise<string> {
  const CFB: any = (await import("cfb")).default ?? (await import("cfb"));
  const { inflateSync } = await import("fflate");
  const cfb = CFB.read(buf, { type: "array" });
  const header = CFB.find(cfb, "/FileHeader") ?? CFB.find(cfb, "FileHeader");
  if (!header?.content) throw new Error("HWP 파일 헤더를 읽지 못했습니다(HWP 5.x 형식이 아닐 수 있음)");
  const hb = Uint8Array.from(header.content as ArrayLike<number>);
  const flags = new DataView(hb.buffer, hb.byteOffset, hb.byteLength).getUint32(36, true);
  const compressed = (flags & 1) !== 0;
  const encrypted = (flags & 2) !== 0;
  if (encrypted) throw new Error("암호가 걸린 HWP는 읽을 수 없습니다. 암호를 해제하거나 PDF로 저장해 올려주세요");

  const sections = cfb.FullPaths
    .map((p: string, i: number) => ({ p, e: cfb.FileIndex[i] }))
    .filter((x: any) => /\/BodyText\/Section\d+$/.test(x.p))
    .sort((a: any, b: any) => (parseInt(a.p.replace(/\D/g, "")) || 0) - (parseInt(b.p.replace(/\D/g, "")) || 0));
  if (!sections.length) throw new Error("HWP 본문(BodyText)을 찾지 못했습니다(배포용 문서는 PDF로 저장해 올려주세요)");

  const out: string[] = [];
  for (const s of sections) {
    let bytes = Uint8Array.from(s.e.content as ArrayLike<number>);
    if (compressed) bytes = inflateSync(bytes);
    out.push(hwpSectionToText(bytes));
  }
  return out.join("\n");
}

// ── XLSX / XLS ──────────────────────────────────────
export async function xlsxToText(buf: Uint8Array): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: false, blankrows: false });
    out.push(`[${name}]`);
    for (const r of rows) {
      const cells = (r as any[]).map(c => (c == null ? "" : String(c).trim())).filter(c => c !== "");
      if (cells.length) out.push(cells.join("  "));
    }
  }
  return out.join("\n");
}

// ── OCR (이미지 / 스캔 PDF) ─────────────────────────
let ocrWorkerPromise: Promise<any> | null = null;

async function getOcrWorker(progress?: ProgressFn) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      progress?.("OCR 엔진 준비 중… (처음 한 번은 한글 학습 데이터를 내려받습니다)");
      return createWorker(["kor", "eng"], 1, {
        logger: (m: any) => {
          if (m?.status === "recognizing text" && typeof m.progress === "number") {
            progress?.(`글자 인식 중… ${Math.round(m.progress * 100)}%`);
          }
        },
      });
    })().catch(e => { ocrWorkerPromise = null; throw e; });
  }
  return ocrWorkerPromise;
}

export async function ocrImage(src: Blob | HTMLCanvasElement, progress?: ProgressFn): Promise<string> {
  const worker = await getOcrWorker(progress);
  const r = await worker.recognize(src);
  return String(r?.data?.text ?? "");
}

// ── PDF ─────────────────────────────────────────────
export async function pdfToText(buf: Uint8Array, progress?: ProgressFn): Promise<{ text: string; ocr: boolean }> {
  const pdfjs: any = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const w: any = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = w.default;
  }
  const doc = await pdfjs.getDocument({ data: buf.slice() }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    progress?.(`PDF 읽는 중… ${p}/${doc.numPages}쪽`);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // y좌표가 같은 조각은 같은 줄로 묶는다
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as any[]) {
      if (!("str" in it) || !it.str) continue;
      const y = Math.round(it.transform[5] / 3);
      const arr = rows.get(y) ?? [];
      arr.push({ x: it.transform[4], s: it.str });
      rows.set(y, arr);
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, arr]) => arr.sort((a, b) => a.x - b.x).map(a => a.s).join(" "));
    pages.push(lines.join("\n"));
  }
  const text = pages.join("\n");
  if (text.replace(/\s/g, "").length >= 30) return { text, ocr: false };

  // 글자가 거의 없으면 스캔본으로 보고 앞 5쪽을 OCR
  const ocrPages: string[] = [];
  const max = Math.min(doc.numPages, 5);
  for (let p = 1; p <= max; p++) {
    progress?.(`스캔 PDF 인식 중… ${p}/${max}쪽`);
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    ocrPages.push(await ocrImage(canvas, progress));
  }
  return { text: ocrPages.join("\n"), ocr: true };
}

// ── 진입점 ──────────────────────────────────────────
export async function parseExamFile(file: File, progress?: ProgressFn): Promise<ParsedDoc> {
  const kind = detectKind(file);
  if (kind === "image") {
    progress?.("이미지를 글자로 읽는 중…");
    return { kind, text: await ocrImage(file, progress), method: "이미지 OCR" };
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  switch (kind) {
    case "text": return { kind, text: decodeTextBytes(buf), method: "텍스트" };
    case "docx": return { kind, text: await docxToText(buf), method: "Word 본문" };
    case "hwpx": return { kind, text: await hwpxToText(buf), method: "HWPX 본문" };
    case "hwp": return { kind, text: await hwpToText(buf), method: "HWP 본문" };
    case "xlsx": return { kind, text: await xlsxToText(buf), method: "엑셀 시트" };
    case "pdf": {
      const r = await pdfToText(buf, progress);
      return { kind, text: r.text, method: r.ocr ? "스캔 PDF OCR" : "PDF 본문" };
    }
    default:
      throw new Error(`지원하지 않는 형식입니다: ${file.name}`);
  }
}
