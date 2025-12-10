import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { query } from "../db/db.js";

const router = express.Router();

// Helper: create hashed refresh token
function hashRefresh(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Helper: generate new refresh token
function generateRefreshToken() {
  return crypto.randomBytes(40).toString("hex");
}

// Helper: sign new access token
function signAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      premium: user.premium,
      premium_until: user.premium_until,
      tokenVersion: user.token_version
    },
    process.env.JWT_SECRET,
    { expiresIn: "30m" }
  );
}

// ==========================================
// REFRESH TOKEN ENDPOINT
// ==========================================
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ error: "Refresh token required" });

    const refreshHash = hashRefresh(refreshToken);

    // Validate refresh token
    const tokenRes = await query(
      `SELECT user_id FROM refresh_tokens
       WHERE token_hash=$1 AND expires_at > NOW()`,
      [refreshHash]
    );

    if (tokenRes.rows.length === 0)
      return res.status(401).json({ error: "Invalid or expired refresh token" });

    const userId = tokenRes.rows[0].user_id;

    // Load user for new access token
    const userRes = await query(
      `SELECT id, email, premium, premium_until, token_version
       FROM users WHERE id=$1`,
      [userId]
    );

    const user = userRes.rows[0];

    // Rotate refresh tokens
    const newRefreshToken = generateRefreshToken();
    const newHash = hashRefresh(newRefreshToken);

    await query(
      `UPDATE refresh_tokens
       SET token_hash=$1, expires_at = NOW() + INTERVAL '30 days'
       WHERE user_id=$2`,
      [newHash, userId]
    );

    // Issue new access token
    const newAccessToken = signAccessToken(user);

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });

  } catch (err) {
    console.error("REFRESH ERROR:", err);
    return res.status(500).json({ error: "Failed to refresh token" });
  }
});

export default router;
