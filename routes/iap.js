import express from "express";
import { query } from "../db/db.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /api/iap/spec-unlock
 * Body:
 * {
 *   vrm: "X6ATK",
 *   sku: "spec_unlock_standard" | "spec_unlock_premium",
 *   platform: "ios" | "android",
 *   receipt?: string,
 *   purchaseToken?: string
 * }
 */
router.post("/spec-unlock", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { vrm, free } = req.body; // 👈 read `free`

    if (!vrm) {
      return res.status(400).json({ success: false, error: "Missing VRM" });
    }

    // 1️⃣ Already unlocked? Return success (idempotent)
    const existing = await query(
      `SELECT 1 FROM unlocked_specs WHERE user_id = $1 AND vrm = $2`,
      [userId, vrm]
    );

    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        alreadyUnlocked: true,
      });
    }

    // 2️⃣ Insert unlock
    await query(
      `INSERT INTO unlocked_specs (user_id, vrm)
       VALUES ($1, $2)`,
      [userId, vrm]
    );

    // 3️⃣ FREE unlock accounting (THIS was missing)
    if (free === true) {
      await query(
        `UPDATE users
         SET monthly_unlocks_used = monthly_unlocks_used + 1
         WHERE id = $1`,
        [userId]
      );
    }

    return res.json({
      success: true,
      unlocked: true,
    });
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);
    res.status(500).json({
      success: false,
      error: "Failed to unlock spec",
    });
  }
});


export default router;
