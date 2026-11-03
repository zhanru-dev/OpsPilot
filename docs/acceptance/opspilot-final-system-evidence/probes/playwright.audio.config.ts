import {defineConfig} from "@playwright/test";import base from "./playwright.broadcast.config";export default defineConfig({...base,testMatch:"final-audit-audio.spec.ts",timeout:60000});
