import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }  // Railway requires SSL
});

export async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}
