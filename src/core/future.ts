import type { ExamResult } from "./types";

// ===== 미래 기능 인터페이스 (구현하지 않음, 자리만 확보) =====

// ASX_CSC — Construction Genome 연동
export interface ASX_CSC {
  linkResult(result: ExamResult): Promise<void>;
}

// HELIX — 학습 경로 엔진
export interface HELIX {
  recommendNext(studentCode: string): Promise<string[]>;
}

// AI 분석
export interface AIAnalysis {
  analyzeWeakness(results: ExamResult[]): Promise<string>;
}

// PDF 리포트
export interface PDFReport {
  generate(result: ExamResult): Promise<Blob>;
}

// 학생 성장 그래프
export interface GrowthGraph {
  seriesFor(studentCode: string, results: ExamResult[]): { date: string; percent: number }[];
}
