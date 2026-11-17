import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  // Only needed for `db:migrate`; `db:generate` works without a database.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
