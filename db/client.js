// db/client.js
import pkg from "pg";

const { Pool } = pkg;

// Railway usually exposes DATABASE_URL when you link Postgres to this service
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("⚠ DATABASE_URL is not set. Postgres will not work.");
}

export const pool = new Pool({
  connectionString,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

export async function query(text, params) {
  return pool.query(text, params);
}
