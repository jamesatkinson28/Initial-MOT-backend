// routes/account.js
import express from "express";
import { authRequired, optionalAuth } from "../middleware/auth.js";
import { query } from "../db/db.js";

const router = express.Router();

/**
 * Reset monthly unlocks if a new billing cycle has started
 */
async function maybeResetMonthlyUnlocks(userId, premiumSince, lastReset) {
  if (!premiumSince) return;

  const now = new Date();
  const start = new Date(premiumSince);

  // Reset day = same day of month as subscription start
  const resetDateThisMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    start.getDate()
  );

  const lastResetDate = lastReset ? new Date(lastReset) : null;

  // Reset only once per cycle
  if (
    now >= resetDateThisMonth &&
    (!lastResetDate || lastResetDate < resetDateThisMonth)
  ) {
    await query(
      `
      UPDATE users
      SET monthly_unlocks_used = 0,
          monthly_unlocks_reset_at = NOW()
      WHERE uuid = $1
      `,
      [userId]
    );
  }
}

/**
 * GET /api/account/overview
 * Returns: email, premium, premium_until, monthly_unlocks_remaining, total_unlocked
 */
router.get("/account/overview", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch user incl reset metadata
    const userRes = await query(
      `
      SELECT
        email,
        premium,
        premium_until,
        premium_since,
        monthly_unlocks_used,
        monthly_unlocks_reset_at
      FROM users
      WHERE uuid = $1
      `,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    let user = userRes.rows[0];

    // 🔁 Lazy monthly reset (only for premium users)
    if (user.premium) {
      await maybeResetMonthlyUnlocks(
        userId,
        user.premium_since,
        user.monthly_unlocks_reset_at
      );

      // Re-fetch unlock count after possible reset
      const refreshed = await query(
        `SELECT monthly_unlocks_used FROM users WHERE uuid = $1`,
        [userId]
      );

      user.monthly_unlocks_used =
        refreshed.rows[0]?.monthly_unlocks_used ?? 0;
    }

    // Total unlocked specs
    const unlocksRes = await query(
      `SELECT COUNT(*)::int AS count FROM unlocked_specs WHERE user_id = $1`,
      [userId]
    );

    // List of unlocked VRMs
    const vrmsRes = await query(
      `SELECT vrm FROM unlocked_specs WHERE user_id = $1`,
      [userId]
    );

    const unlockedVrms = vrmsRes.rows.map(r => r.vrm);

    return res.json({
      email: user.email,
      premium: user.premium,
      premium_until: user.premium_until,

      // 🔢 Remaining monthly free unlocks
      monthly_unlocks_remaining: user.premium
        ? Math.max(3 - user.monthly_unlocks_used, 0)
        : 0,

      total_unlocked: unlocksRes.rows[0]?.count || 0,
      unlocked_vrms: unlockedVrms,
    });
  } catch (err) {
    console.error("[Account] overview error:", err);
    res.status(500).json({ error: "Failed to load account overview" });
  }
});

/**
 * GET /api/account/overview-guest
 * Guest identity required via x-guest-id header or ?guestId=
 * Returns: premium, premium_until, monthly_unlocks_remaining, total_unlocked, unlocked_vrms
 */
router.get("/account/overview-guest", optionalAuth, async (req, res) => {
  try {
    const guestId =
      req.guestId ??
      req.query?.guestId ??
      req.headers["x-guest-id"] ??
      req.headers["x-device-id"] ??
      null;

    if (!guestId) {
      return res.status(400).json({ error: "guestId required" });
    }

    // ✅ Premium entitlement (guest)
    const premRes = await query(
      `
      SELECT premium_until, monthly_unlocks_used
      FROM premium_entitlements
      WHERE guest_id = $1
        AND premium_until > NOW()
      ORDER BY premium_until DESC
      LIMIT 1
      `,
      [guestId]
    );

    const premium = premRes.rowCount > 0;
    const premium_until = premium ? premRes.rows[0].premium_until : null;
    const used = premium ? Number(premRes.rows[0].monthly_unlocks_used ?? 0) : 0;

    const monthly_unlocks_remaining = premium ? Math.max(3 - used, 0) : 0;

    // ✅ Total unlocked specs (guest)
    const unlocksRes = await query(
      `SELECT COUNT(*)::int AS count FROM unlocked_specs WHERE guest_id = $1`,
      [guestId]
    );

    const vrmsRes = await query(
      `SELECT vrm FROM unlocked_specs WHERE guest_id = $1`,
      [guestId]
    );

    const unlockedVrms = vrmsRes.rows.map((r) => r.vrm);

    return res.json({
      premium,
      premium_until,
      monthly_unlocks_remaining,
      total_unlocked: unlocksRes.rows[0]?.count || 0,
      unlocked_vrms: unlockedVrms,
    });
  } catch (err) {
    console.error("[Account] overview-guest error:", err);
    return res.status(500).json({ error: "Failed to load guest account overview" });
  }
});


export default router;
