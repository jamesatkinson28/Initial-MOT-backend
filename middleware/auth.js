// middleware/auth.js
import jwt from "jsonwebtoken";
import { query } from "../db/db.js";

export async function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing token" });

    // Decode token
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch token_version from DB
    const userRes = await query("SELECT token_version FROM users WHERE uuid = $1", [
      payload.id,
    ]);

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    const dbVersion = userRes.rows[0].token_version;

    // 🔥 Session invalidation check:
    // If tokenVersion (from JWT) !== DB token_version → force logout
    if (payload.tokenVersion !== dbVersion) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    // Attach user
    req.user = {
      id: payload.id,
	  legacyId: payload.legacyId,
      email: payload.email,
      premium: payload.premium,
      premium_until: payload.premium_until,
      tokenVersion: payload.tokenVersion,
    };

    next();
  } catch (err) {
    console.error("AUTH MIDDLEWARE ERROR:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req, res, next) {
  // ----------------------------
  // 1) Try auth (non-fatal)
  // ----------------------------
  req.user = null;

  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const payload = jwt.verify(token, process.env.JWT_SECRET);

      req.user = {
        id: payload.id,
		legacyId: payload.legacyId,
        email: payload.email,
        premium: payload.premium,
        premium_until: payload.premium_until,
        tokenVersion: payload.tokenVersion,
      };
    } catch {
      // invalid token → treat as guest (do not 401 here)
      req.user = null;
    }
  }

  // ----------------------------
  // 2) Guest id: accept header OR query OR body
  // ----------------------------
  req.guestId =
    req.headers["x-guest-id"] ||
    req.headers["x-device-id"] ||
    req.query?.guestId ||
    req.body?.guestId ||
    null;

  next();
}

