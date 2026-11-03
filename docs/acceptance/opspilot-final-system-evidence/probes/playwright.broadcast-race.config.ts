import {defineConfig} from "@playwright/test";import base from "./playwright.broadcast.config";export default defineConfig({...base,testMatch:"final-audit-broadcast-race.spec.ts",timeout:60000});
