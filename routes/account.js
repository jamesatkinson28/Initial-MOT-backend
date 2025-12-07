// routes/account.js
import express from "express";
import authMiddleware from "../middleware/auth.js";
import { query } from "../db/db.js";

const router = express.Router();

/**
 * GET /api/account/overview
 * Returns: email, premium, premium_until, monthly_unlocks_remaining, total_unlocked
 */
router.get("/account/overview", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const userRes = await query(
      `
      SELECT email, premium, premium_until, monthly_unlocks_remaining
      FROM users
      WHERE id = $1
    `,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const unlocksRes = await query(
      `SELECT COUNT(*)::int AS count FROM unlocked_specs WHERE user_id = $1`,
      [userId]
    );

    const user = userRes.rows[0];

    return res.json({
      email: user.email,
      premium: user.premium,
      premium_until: user.premium_until,
      monthly_unlocks_remaining: user.monthly_unlocks_remaining,
      total_unlocked: unlocksRes.rows[0].count || 0,
    });
  } catch (err) {
    console.error("[Account] overview error:", err);
    res.status(500).json({ error: "Failed to load account overview" });
  }
});

export default router;
