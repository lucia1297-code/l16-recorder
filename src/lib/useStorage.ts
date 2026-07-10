import { useMemo } from "react";
import { createStorage } from "./storageFactory";

// 앱 전역에서 단일 스토리지 인스턴스 사용
let singleton = createStorage();

export function useStorage() {
  return useMemo(() => singleton, []);
}
