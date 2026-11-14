// 시험 자료(공문·시험범위표·시간표 등)에서 뽑아낸 텍스트 → 시험 일정 폼 필드로 자동 분류.
// 규칙 기반(오프라인·결정적)이라 같은 입력이면 항상 같은 결과가 나온다.

export interface ExamFields {
  semester: "1" | "2";
  examType: "midterm" | "final";
  subject: string;
  examStart: string;
  examEnd: string;
  englishExamDate: string;
  examRange: string;
  reportDeadline: string;
}

export interface ExtractHit {
  field: keyof ExamFields;
  label: string;
  value: string;
  evidence: string; // 근거가 된 원문 한 줄
}

export interface ExtractResult {
  fields: Partial<ExamFields>;
  hits: ExtractHit[];
  matchedStudentCodes: string[];
}

const FIELD_LABEL: Record<keyof ExamFields, string> = {
  semester: "학기",
  examType: "시험 종류",
  subject: "과목명",
  examStart: "시험 시작일",
  examEnd: "시험 종료일",
  englishExamDate: "영어 시험일",
  examRange: "시험 범위",
  reportDeadline: "직보일",
};

function pad(n: number) { return String(n).padStart(2, "0"); }

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export interface FoundDate { value: string; index: number; end: number }

/** 한 줄에서 날짜를 모두 찾는다. 연도가 없으면 defaultYear 사용. */
export function findDates(line: string, defaultYear: number, loose = false): FoundDate[] {
  const out: FoundDate[] = [];
  const re = new RegExp(
    [
      "(\\d{4})\\s*[.\\-/년]\\s*(\\d{1,2})\\s*[.\\-/월]\\s*(\\d{1,2})\\s*일?", // 2026.11.14 / 2026년 11월 14일
      "(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일?", // 11월 14일
      "(?<![\\d.])(\\d{1,2})\\s*[./]\\s*(\\d{1,2})(?![\\d.]*\\d)\\s*(\\(\\s*[월화수목금토일]\\s*\\))?", // 11/14, 11.14(금)
    ].join("|"),
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    let y = defaultYear, mo = 0, d = 0;
    if (m[1]) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if (m[4]) { mo = +m[4]; d = +m[5]; }
    else if (m[6]) {
      // 슬래시/점 형식은 오탐이 많아 요일 괄호가 있거나 loose 모드일 때만 허용
      if (!m[8] && !loose) continue;
      mo = +m[6]; d = +m[7];
    }
    if (!validYmd(y, mo, d)) continue;
    out.push({ value: ymd(y, mo, d), index: m.index, end: m.index + m[0].length });
  }
  return out;
}

const RANGE_SEP = /\s*(?:~|∼|〜|–|—|-|부터)\s*/;

/** "5.6(월) ~ 5.9(목)" / "5/6 ~ 9" 형태의 기간. */
export function findRange(line: string, defaultYear: number): { start: string; end: string } | null {
  const ds = findDates(line, defaultYear, true);
  if (ds.length >= 2) {
    for (let i = 0; i < ds.length - 1; i++) {
      const between = line.slice(ds[i].end, ds[i + 1].index);
      if (RANGE_SEP.test(between) && between.replace(RANGE_SEP, "").replace(/\([월화수목금토일]\)/g, "").trim() === "") {
        const [a, b] = [ds[i].value, ds[i + 1].value].sort();
        return { start: a, end: b };
      }
    }
  }
  if (ds.length === 1) {
    // "5/6 ~ 9" : 뒤쪽이 일(day)만 있는 경우
    const rest = line.slice(ds[0].end);
    const m = /^\s*(?:\([월화수목금토일]\))?\s*(?:~|∼|〜|–|—|-|부터)\s*(\d{1,2})\s*일?(?!\d)/.exec(rest);
    if (m) {
      const [y, mo] = ds[0].value.split("-").map(Number);
      const d = +m[1];
      if (validYmd(y, mo, d)) {
        const [a, b] = [ds[0].value, ymd(y, mo, d)].sort();
        return { start: a, end: b };
      }
    }
  }
  return null;
}

function clean(s: string): string {
  return s.replace(/[ \t 　]+/g, " ").trim();
}

function detectYear(text: string, fallback: number): number {
  const m = /(20\d{2})\s*(?:학년도|년|[.\-/])/.exec(text);
  if (m) {
    const y = +m[1];
    // "2026학년도 1학기"는 같은 해 3~7월이므로 그대로 사용, 2학기는 그 해 하반기
    return y;
  }
  return fallback;
}

/** 본문 텍스트에서 시험 일정 필드를 뽑는다. */
export function extractExamFields(
  rawText: string,
  opts: { fileName?: string; today?: Date; roster?: { studentCode: string; name: string }[] } = {},
): ExtractResult {
  const today = opts.today ?? new Date();
  const text = rawText.replace(/\r/g, "");
  const lines = text.split("\n").map(clean).filter(Boolean);
  const year = detectYear(`${opts.fileName ?? ""}\n${text}`, today.getFullYear());

  const fields: Partial<ExamFields> = {};
  const hits: ExtractHit[] = [];
  const put = <K extends keyof ExamFields>(f: K, v: ExamFields[K], evidence: string) => {
    if (fields[f] !== undefined) return;
    fields[f] = v;
    hits.push({ field: f, label: FIELD_LABEL[f], value: String(v), evidence: evidence.slice(0, 120) });
  };

  const head = `${opts.fileName ?? ""}\n${lines.slice(0, 15).join("\n")}`;

  // 학기 / 시험 종류
  const semM = /([12])\s*학기/.exec(head) ?? /([12])\s*학기/.exec(text);
  if (semM) put("semester", semM[1] as "1" | "2", semM[0]);
  const typeM = /(중간|기말)\s*(?:고사|평가|시험)?/.exec(head) ?? /(중간|기말)\s*(?:고사|평가|시험)/.exec(text);
  if (typeM) put("examType", typeM[1] === "중간" ? "midterm" : "final", typeM[0]);

  // 시험 기간
  const periodKey = /(시험|고사|평가)\s*(기간|일정|일시)|정기\s*고사|지필/;
  for (let i = 0; i < lines.length; i++) {
    if (!periodKey.test(lines[i])) continue;
    const r = findRange(lines[i], year) ?? (lines[i + 1] ? findRange(lines[i + 1], year) : null);
    if (r) {
      put("examStart", r.start, lines[i]);
      put("examEnd", r.end, lines[i]);
      break;
    }
  }

  // 영어 시험일: "영어"가 들어간 줄의 날짜. 없으면 시간표형 문서에서 바로 위쪽 날짜 줄.
  const engRe = /영어|English|ENGLISH|영독|영문/;
  let englishDate = "";
  let englishEvidence = "";
  for (let i = 0; i < lines.length && !englishDate; i++) {
    if (!engRe.test(lines[i]) || /듣기\s*평가\s*방송/.test(lines[i])) continue;
    if (/(범위|출제)/.test(lines[i]) && !findDates(lines[i], year, true).length) continue;
    const here = findDates(lines[i], year, true);
    if (here.length) { englishDate = here[0].value; englishEvidence = lines[i]; break; }
    for (let k = 1; k <= 3 && i - k >= 0; k++) {
      const up = findDates(lines[i - k], year, true);
      if (up.length) { englishDate = up[up.length - 1].value; englishEvidence = `${lines[i - k]} / ${lines[i]}`; break; }
    }
  }
  if (englishDate) put("englishExamDate", englishDate, englishEvidence);

  // 직보일 / 성적 보고 기한
  const reportRe = /직보|성적\s*(?:보고|제출|통보)|결과\s*보고/;
  for (let i = 0; i < lines.length; i++) {
    if (!reportRe.test(lines[i])) continue;
    const ds = findDates(lines[i], year, true);
    const d = ds[0] ?? (lines[i + 1] ? findDates(lines[i + 1], year, true)[0] : undefined);
    if (d) { put("reportDeadline", d.value, lines[i]); break; }
  }

  // 시험 범위: 영어 범위 줄 우선, 없으면 일반 "시험범위/출제범위" 줄 이후
  const rangeKey = /(시험|출제|평가)?\s*범위/;
  let rangeText = "";
  let rangeEvidence = "";
  for (let i = 0; i < lines.length && !rangeText; i++) {
    if (!rangeKey.test(lines[i])) continue;
    const m = /범위\s*[:：]?\s*(.*)$/.exec(lines[i]);
    const parts: string[] = [];
    if (m && m[1]) parts.push(m[1]);
    // 다음 줄들 중 새 항목(번호/라벨)이 시작되기 전까지 최대 3줄 이어붙임
    for (let k = 1; k <= 3 && i + k < lines.length; k++) {
      const nx = lines[i + k];
      if (/^(?:[0-9]+\s*[.)]|[가-힣A-Za-z]{1,6}\s*[:：])/.test(nx) && !/교과서|부교재|Lesson|Unit|모의|프린트|EBS|워크북/i.test(nx)) break;
      if (periodKey.test(nx) || reportRe.test(nx)) break;
      parts.push(nx);
    }
    const joined = clean(parts.join(" "));
    if (joined.length >= 2) { rangeText = joined; rangeEvidence = lines[i]; }
  }
  // 영어 전용 범위 줄(예: "영어: 교과서 1~3과 ...")
  for (let i = 0; i < lines.length; i++) {
    if (/^영어\s*[:：]\s*\S/.test(lines[i]) && /과|Unit|Lesson|교과서|부교재|모의|프린트|EBS/i.test(lines[i])) {
      rangeText = clean(lines[i].replace(/^영어\s*[:：]\s*/, ""));
      rangeEvidence = lines[i];
      break;
    }
  }
  if (rangeText) put("examRange", rangeText.slice(0, 400), rangeEvidence);

  // 과목: 영어 관련 문서면 영어 (폼 기본값과 같지만, 다른 과목 명시 시 대응)
  const subjM = /(영어\s*[ⅠⅡI]{1,2}|영어\s*독해와\s*작문|영어\s*회화|영어\s*독해|영어\s*[12]|공통영어\s*[12]?|영어)/.exec(`${opts.fileName ?? ""}\n${head}`);
  if (subjM) put("subject", clean(subjM[1]), subjM[0]);

  // 학생 자동 식별: 파일명/본문에 명부의 이름이 정확히 하나만 나오면 선택
  const matched: string[] = [];
  if (opts.roster) {
    const hay = `${opts.fileName ?? ""}\n${text}`;
    for (const r of opts.roster) {
      if (r.name && r.name.length >= 2 && hay.includes(r.name)) matched.push(r.studentCode);
    }
  }

  return { fields, hits, matchedStudentCodes: matched };
}
