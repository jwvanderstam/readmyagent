// Applies the migrations in ./drizzle. Vercel runs this before every build (vercel.json), so
// production is migrated without its credentials ever leaving Vercel. Preview builds have no
// database by design (operations 1.2) and are skipped.
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log(`migrate: skipped for the ${process.env.VERCEL_ENV ?? "unknown"} environment`);
  process.exit(0);
}

// Neon advises a direct (unpooled) connection for schema changes.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  console.log("migrate: database is up to date");
} finally {
  await pool.end();
}
