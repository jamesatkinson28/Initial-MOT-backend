// middleware/auth.js
import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user payload to request for later use
    req.user = {
      id: payload.id,
      email: payload.email,
      premium: payload.premium,
      premium_until: payload.premium_until
    };

    next();
  } catch (err) {
    console.error("AUTH MIDDLEWARE ERROR:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
