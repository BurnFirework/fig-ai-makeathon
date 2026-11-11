import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.', testMatch: '**/*.browser.spec.ts', outputDir: '../output/browser-tests',
  use: { baseURL: 'http://127.0.0.1:43130', actionTimeout: 15000 },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  timeout: 45000, workers: 1, reporter: 'list',
  webServer: { cwd: process.cwd(), command: 'pnpm exec vite --config tests/vite-static.config.ts --host 127.0.0.1 --port 43130', url: 'http://127.0.0.1:43130', reuseExistingServer: true },
})
