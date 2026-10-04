import { FlatCompat } from "@eslint/eslintrc";

// ESLint 9 needs an explicit flat configuration; use the installed Next/TypeScript rules.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
  { ignores: [".next/**", ".next-e2e/**", "out/**", "node_modules/**", "android/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
