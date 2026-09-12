// 관리자 패널 메타데이터 (자동 메뉴/렌더링 생성용)

import { ReactNode } from "react";
import MemoPanel from "./MemoPanel";
import AdminInputPanel from "./AdminInputPanel";
import ExamPrepPanel from "./ExamPrepPanel";
import ExamPlanPanel from "./ExamPlanPanel";
import GrowthPanel from "./GrowthPanel";
import RecordingPanel from "./RecordingPanel";
import WWOrderPanel from "./WWOrderPanel";
import CalculatorPanel from "./CalculatorPanel";
import TimetablePanel from "./TimetablePanel";
import ExamSchedulePanel from "./ExamSchedulePanel";
import SchedulePanel from "./SchedulePanel";
import MaterialPanel from "./MaterialPanel";

export type AdminTab =
  | "list" | "dash" | "roster" | "pending" | "assignment" | "review"
  | "teacherlog" | "submit" | "report" | "sms" | "scheduled"
  | "examschedule" | "examprep" | "examplan" | "growth"
  | "recording" | "wworder" | "admininput" | "memo" | "material"
  | "schedule" | "calculator" | "timetable";

export interface PanelConfig {
  id: AdminTab;
  icon: string;
  label: string;
  group: "모의고사" | "학생 관리" | "과제" | "수업" | "시험" | "기타";
  component: React.ComponentType<any> | null; // null이면 외부 패널
}

export const ADMIN_PANELS: Record<AdminTab, PanelConfig> = {
  // 모의고사
  list: {
    id: "list",
    icon: "📊",
    label: "제출목록",
    group: "모의고사",
    component: null,
  },
  admininput: {
    id: "admininput",
    icon: "✏️",
    label: "직접 입력",
    group: "모의고사",
    component: AdminInputPanel,
  },
  dash: {
    id: "dash",
    icon: "📈",
    label: "대시보드",
    group: "모의고사",
    component: null,
  },
  report: {
    id: "report",
    icon: "🔍",
    label: "학생 분석",
    group: "모의고사",
    component: null,
  },

  // 학생 관리
  roster: {
    id: "roster",
    icon: "👥",
    label: "명부 관리",
    group: "학생 관리",
    component: null,
  },
  pending: {
    id: "pending",
    icon: "📝",
    label: "등록 신청",
    group: "학생 관리",
    component: null,
  },

  // 과제
  assignment: {
    id: "assignment",
    icon: "📋",
    label: "과제 관리",
    group: "과제",
    component: null,
  },
  review: {
    id: "review",
    icon: "✅",
    label: "과제 점검",
    group: "과제",
    component: null,
  },
  teacherlog: {
    id: "teacherlog",
    icon: "🖊",
    label: "과제 입력",
    group: "과제",
    component: null,
  },
  submit: {
    id: "submit",
    icon: "📌",
    label: "제출 현황",
    group: "과제",
    component: null,
  },
  material: {
    id: "material",
    icon: "📦",
    label: "자료 제공",
    group: "과제",
    component: MaterialPanel,
  },

  // 수업
  timetable: {
    id: "timetable",
    icon: "📅",
    label: "수업 시간표",
    group: "수업",
    component: TimetablePanel,
  },
  recording: {
    id: "recording",
    icon: "🎙",
    label: "녹음분석",
    group: "수업",
    component: RecordingPanel,
  },
  growth: {
    id: "growth",
    icon: "💬",
    label: "발전기록",
    group: "수업",
    component: GrowthPanel,
  },
  sms: {
    id: "sms",
    icon: "📱",
    label: "문자알림",
    group: "수업",
    component: null,
  },
  scheduled: {
    id: "scheduled",
    icon: "📅",
    label: "예약발송",
    group: "수업",
    component: null,
  },

  // 시험
  examschedule: {
    id: "examschedule",
    icon: "📊",
    label: "시험일정 chart",
    group: "시험",
    component: ExamSchedulePanel,
  },
  examprep: {
    id: "examprep",
    icon: "📅",
    label: "시험일정",
    group: "시험",
    component: ExamPrepPanel,
  },
  examplan: {
    id: "examplan",
    icon: "📆",
    label: "시험계획",
    group: "시험",
    component: ExamPlanPanel,
  },
  schedule: {
    id: "schedule",
    icon: "🗓",
    label: "일정관리",
    group: "시험",
    component: SchedulePanel,
  },

  // 기타
  memo: {
    id: "memo",
    icon: "📝",
    label: "메모",
    group: "기타",
    component: MemoPanel,
  },
  calculator: {
    id: "calculator",
    icon: "🧮",
    label: "계산기",
    group: "기타",
    component: CalculatorPanel,
  },
  wworder: {
    id: "wworder",
    icon: "📦",
    label: "주문관리",
    group: "기타",
    component: WWOrderPanel,
  },
};

// 그룹별 정렬된 패널 가져오기
export function getPanelsByGroup(group: PanelConfig["group"]): PanelConfig[] {
  return Object.values(ADMIN_PANELS).filter(p => p.group === group);
}

// 모든 그룹 가져오기
export const GROUPS: PanelConfig["group"][] = [
  "모의고사",
  "학생 관리",
  "과제",
  "수업",
  "시험",
  "기타",
];
