import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/", "node_modules/", "coverage/", "next-env.d.ts"] },
  ...nextVitals,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
