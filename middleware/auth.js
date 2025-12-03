// middleware/auth.js
import jwt from "jsonwebtoken";
import { query } from "../db.js";

// Sign a JWT for a user row from the DB
export function signUserToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    premium: user.premium,
    premium_until: user.premium_until,
    monthly_unlocks_remaining: user.monthly_unlocks_remaining,
  };

  const secret = process.env.JWT_SECRET || "dev-secret-change-me";

  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

// Express middleware to require a valid JWT and attach user to req.user
export async function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: "Authorization token missing." });
    }

    const secret = process.env.JWT_SECRET || "dev-secret-change-me";

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    // Look up the user in DB to ensure they still exist and get latest data
    const { rows } = await query(
      `SELECT id, email, premium, premium_until,
              monthly_unlocks_remaining, last_unlock_reset
       FROM users
       WHERE id = $1`,
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "User not found." });
    }

    req.user = rows[0];
    return next();
  } catch (err) {
    console.error("authRequired error:", err.message);
    return res.status(500).json({ error: "Auth check failed." });
  }
}
