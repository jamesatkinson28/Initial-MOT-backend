// routes/account.js
import express from "express";
import { authRequired, optionalAuth } from "../middleware/auth.js";
import { query } from "../db/db.js";

const router = express.Router();


function daysInMonth(year, monthIndex0) {
  // monthIndex0: 0-11
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function clampDayToMonth(year, monthIndex0, anchorDay) {
  return Math.min(anchorDay, daysInMonth(year, monthIndex0));
}

/**
 * Compute the reset moment for THIS month based on anchorDay.
 * Example: anchorDay=31 in Feb -> Feb 28/29
 */
function resetDateForMonth(now, anchorDay) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = clampDayToMonth(y, m, anchorDay);
  return new Date(y, m, d, 0, 0, 0, 0); // midnight local server time
}


/**
 * Reset monthly unlocks if a new billing cycle has started
 */
async function maybeResetMonthlyUnlocks(userUuid, anchorDay, lastResetAt) {
  if (!anchorDay) return;

  const now = new Date();
  const resetThisMonth = resetDateForMonth(now, anchorDay);
  const last = lastResetAt ? new Date(lastResetAt) : new Date(0);

  // If we're past the reset date and we haven't reset since that date → reset
  if (now >= resetThisMonth && (!last || last < resetThisMonth)) {
    await query(
      `
      UPDATE premium_entitlements
      SET monthly_unlocks_used = 0,
          monthly_unlocks_reset_at = NOW()
      WHERE user_uuid = $1
        AND status = 'active'
        AND premium_until > NOW()
      `,
      [userUuid]
    );

    console.log("🔄 Monthly unlocks reset (user)", { userUuid, anchorDay });
  }
}

async function maybeResetGuestMonthlyUnlocks(guestId, anchorDay, lastResetAt) {
  if (!anchorDay) return;

  const now = new Date();
  const resetThisMonth = resetDateForMonth(now, anchorDay);
  const last = lastResetAt ? new Date(lastResetAt) : new Date(0);

  if (now >= resetThisMonth && (!last || last < resetThisMonth)) {
    await query(
      `
      UPDATE premium_entitlements
      SET monthly_unlocks_used = 0,
          monthly_unlocks_reset_at = NOW()
      WHERE guest_id = $1
        AND status = 'active'
        AND premium_until > NOW()
      `,
      [guestId]
    );

    console.log("🔄 Monthly unlocks reset (guest)", { guestId, anchorDay });
  }
}
/**
 * GET /api/account/overview
 * Returns: email, premium, premium_until, monthly_unlocks_remaining, total_unlocked
 */
router.get("/account/overview", optionalAuth, async (req, res) => {
  try {
    // ==================================================
    // 1️⃣ LOGGED-IN USER
    // ==================================================
    if (req.user) {
      const userUuid = req.user.id;

      const entRes = await query(
        `
        SELECT premium_until, monthly_unlocks_used, monthly_unlocks_reset_at, created_at
        FROM premium_entitlements
        WHERE user_uuid = $1
          AND status = 'active'
          AND premium_until > NOW()
        LIMIT 1
        `,
        [userUuid]
      );

      const isPremium = entRes.rowCount > 0;
      const ent = entRes.rows[0] ?? null;

      if (isPremium && ent) {
	    const anchorDay = ent.created_at
		  ? new Date(ent.created_at).getDate()
		  : null;

	    await maybeResetMonthlyUnlocks(
		  userUuid,
		  anchorDay,
		  ent.monthly_unlocks_reset_at
	    );
	  }

      // 🔓 Total unlocked
      const unlocksRes = await query(
        `
        SELECT COUNT(*)::int AS count
        FROM unlocked_specs
        WHERE user_id = $1
          AND revoked_at IS NULL
        `,
        [userUuid]
      );

      const vrmsRes = await query(
        `
        SELECT vrm
        FROM unlocked_specs
        WHERE user_id = $1
          AND revoked_at IS NULL
        `,
        [userUuid]
      );

      // 💳 Paid unlock credits
      const creditRes = await query(
        `
        SELECT COALESCE(SUM(delta), 0)::int AS balance
        FROM unlock_credits_ledger
        WHERE user_uuid = $1
        `,
        [userUuid]
      );

      const paidCredits = creditRes.rows[0]?.balance ?? 0;

      return res.json({
        email: req.user.email,
        premium: isPremium,
        premium_until: ent?.premium_until ?? null,
        monthly_unlocks_remaining: isPremium
          ? Math.max(3 - ent.monthly_unlocks_used, 0)
          : 0,
        paid_unlock_credits: paidCredits, // ✅ NEW
        total_unlocked: unlocksRes.rows[0]?.count || 0,
        unlocked_vrms: vrmsRes.rows.map(r => r.vrm),
      });
    }

    // ==================================================
    // 2️⃣ GUEST
    // ==================================================
    const guestId = req.guestId;
    if (!guestId) {
      return res.status(401).json({ error: "Not authorised" });
    }

    const entRes = await query(
      `
      SELECT premium_until, monthly_unlocks_used, monthly_unlocks_reset_at, created_at
      FROM premium_entitlements
      WHERE guest_id = $1
        AND status = 'active'
      LIMIT 1
      `,
      [guestId]
    );

    let premium = false;
    let premiumUntil = null;
    let monthlyUnlocksRemaining = 0;

    if (entRes.rowCount > 0) {
      const ent = entRes.rows[0];

      if (ent.premium_until > new Date()) {
        premium = true;
        premiumUntil = ent.premium_until;

        const anchorDay = ent.created_at
		  ? new Date(ent.created_at).getDate()
		  : null;

		await maybeResetGuestMonthlyUnlocks(
		  guestId,
		  anchorDay,
		  ent.monthly_unlocks_reset_at
		);

        monthlyUnlocksRemaining = Math.max(
          3 - ent.monthly_unlocks_used,
          0
        );
      }
    }

    // 🔓 Total unlocked (guest)
    const unlocksRes = await query(
      `
      SELECT COUNT(*)::int AS count
      FROM unlocked_specs
      WHERE guest_id = $1
        AND revoked_at IS NULL
      `,
      [guestId]
    );

    const vrmsRes = await query(
      `
      SELECT vrm
      FROM unlocked_specs
      WHERE guest_id = $1
        AND revoked_at IS NULL
      `,
      [guestId]
    );

    // 💳 Paid unlock credits (guest)
    const creditRes = await query(
      `
      SELECT COALESCE(SUM(delta), 0)::int AS balance
      FROM unlock_credits_ledger
      WHERE guest_id = $1
      `,
      [guestId]
    );

    const paidCredits = creditRes.rows[0]?.balance ?? 0;

    return res.json({
      premium,
      premium_until: premiumUntil,
      monthly_unlocks_remaining: monthlyUnlocksRemaining,
      paid_unlock_credits: paidCredits, // ✅ NEW
      total_unlocked: unlocksRes.rows[0]?.count || 0,
      unlocked_vrms: vrmsRes.rows.map(r => r.vrm),
    });

  } catch (err) {
    console.error("[Account] overview error:", err);
    res.status(500).json({ error: "Failed to load account overview" });
  }
});



export default router;
