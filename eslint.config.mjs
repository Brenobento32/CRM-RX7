import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Edge Functions rodam em Deno, com outro runtime e outros globais.
    "supabase/functions/**",
    // Projeto Node separado (Baileys) — não é React/Next, tem seu próprio
    // package.json e tooling.
    "whatsapp-service/**",
  ]),
]);

export default eslintConfig;
