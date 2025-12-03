// middleware/auth.js
import jwt from "jsonwebtoken";
import { query } from "../db/client.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export async function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (!token || scheme.toLowerCase() !== "bearer") {
      return res.status(401).json({ error: "Missing or invalid auth token" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await query(
      `SELECT id, email, premium, premium_until, monthly_unlocks_remaining, last_unlock_reset
       FROM users
       WHERE id = $1`,
      [payload.userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    console.error("authRequired error:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function signUserToken(user) {
  const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

  const payload = {
    userId: user.id,
    email: user.email,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}
