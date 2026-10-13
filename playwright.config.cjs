const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', timeout: 30000, fullyParallel: true, workers: 2,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:8765', viewport: { width: 1440, height: 1000 }, headless: true },
  webServer: { command: 'python3 -m http.server 8765 --bind 0.0.0.0', port: 8765, reuseExistingServer: true },
});
