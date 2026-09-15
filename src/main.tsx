import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// 하루에도 여러 번 재배포되는 프로젝트라, 탭을 열어둔 채로 새 배포가 나가면
// 예전 번들이 참조하는 지연 로딩(import()) 청크가 서버에서 이미 사라져
// "Failed to fetch dynamically imported module" 에러가 난다. Vite가 이런
// 상황에 쏘는 vite:preloadError 이벤트를 잡아서 한 번만 자동 새로고침한다
// (새로고침하면 최신 index.html/청크 해시를 다시 받아와서 해결됨).
// 같은 새로고침이 반복되는 진짜 배포 문제라면 무한 새로고침을 막기 위해
// 세션당 한 번만 시도한다.
window.addEventListener("vite:preloadError", () => {
  const KEY = "asx.preloadErrorReloaded";
  if (sessionStorage.getItem(KEY) === "1") return;
  sessionStorage.setItem(KEY, "1");
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
