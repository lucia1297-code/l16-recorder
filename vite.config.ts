/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/l16-recorder/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",          // 업데이트 감지 시 앱에 알림
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "L16 Student Recorder Lite",
        short_name: "L16 Recorder",
        description: "학생 시험 결과 및 오답 기록 앱",
        theme_color: "#2B4C7E",
        background_color: "#FAF9F6",
        display: "standalone",
        start_url: "/",
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
