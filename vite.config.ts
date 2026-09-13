/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/l16-recorder/",
  plugins: [
    react(),
    VitePWA({
      // "prompt"였을 때: 새 버전이 배포돼도 사용자가 업데이트 배너를 직접 눌러야만
      // 최신 서비스워커로 전환됨 — 하루에도 여러 번 재배포하는 이 프로젝트에서는
      // 사용자가 몇 시간 전 서비스워커를 계속 쓰다가, 그사이 재배포로 서버에서
      // 삭제된 예전 해시 파일을 요청해 404가 나는 사고로 이어졌다(2026-09-12).
      // autoUpdate는 새 서비스워커를 백그라운드에서 감지 즉시 적용해 이 간극을 없앤다.
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      workbox: {
        // SPA 네비게이션 요청이 캐시에 없거나 네트워크 실패 시 캐시된 index.html로 폴백
        // (이게 없으면 설치된 PWA가 오래된 파일 참조를 캐시한 채로 열렸을 때 그대로 404가 노출됨)
        navigateFallback: "/l16-recorder/index.html",
        navigateFallbackDenylist: [/^\/l16-recorder\/api\.html/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      manifest: {
        name: "L16 Student Recorder Lite",
        short_name: "L16 Recorder",
        description: "학생 시험 결과 및 오답 기록 앱",
        theme_color: "#2B4C7E",
        background_color: "#FAF9F6",
        display: "standalone",
        start_url: "/l16-recorder/",
        scope: "/l16-recorder/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
});

