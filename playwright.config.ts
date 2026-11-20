import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:60000,
  expect:{timeout:10000},reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://localhost:3000',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:process.env.DARTFLOW_BROWSER_PATH?{executablePath:process.env.DARTFLOW_BROWSER_PATH}:{}},
  webServer:{command:'node scripts/start-test-preview.mjs',url:'http://localhost:3000/api/health',reuseExistingServer:!process.env.CI,timeout:60000},
});
