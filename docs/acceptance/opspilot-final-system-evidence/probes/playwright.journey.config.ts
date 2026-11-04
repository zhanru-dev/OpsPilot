import { defineConfig } from "@playwright/test";
import base from "./playwright.broadcast.config";
export default defineConfig({...base,testMatch:"final-audit-journey.spec.ts",timeout:300000});
