import express from "express";
import { authRequired } from "../middleware/auth.js";
import { query } from "../db/db.js";
import axios from "axios";

const router = express.Router();

// Pricing
const PRICE_STANDARD = 1.49;
const PREMIUM_DISCOUNT = 0.25; // 25% off

// ------------------------------
// Reset monthly unlocks when needed
// ------------------------------
async function resetMonthlyIfNeeded(user_id) {
  const { rows } = await query(
    `SELECT monthly_unlocks_remaining, last_unlock_reset, premium, premium_until
     FROM users WHERE id = $1`,
    [user_id]
  );

  const user = rows[0];
  const now = new Date();
  const lastReset = new Date(user.last_unlock_reset);

  const isNewMonth =
    now.getMonth() !== lastReset.getMonth() ||
    now.getFullYear() !== lastReset.getFullYear();

  if (isNewMonth) {
    await query(
      `UPDATE users
       SET monthly_unlocks_remaining = 3,
           last_unlock_reset = NOW()
       WHERE id = $1`,
      [user_id]
    );
    return 3;
  }

  return user.monthly_unlocks_remaining;
}

// ------------------------------
// Fetch spec data from your API (placeholder)
// Replace this with real API when ready
// ------------------------------
async function fetchSpecDataFromAPI(vrm) {
  // Temporary fake data — replace with real provider later
  return {
    vrm,
    make: "Unknown",
    model: "Unknown",
    engine_size: "Unknown",
    fetched_at: new Date().toISOString()
  };
}

// ------------------------------
// UNLOCK SPEC ENDPOINT
// ------------------------------
router.post("/unlock-spec", authRequired, async (req, res) => {
  try {
    const { vrm } = req.body;
    const user_id = req.user.id;

    if (!vrm)
      return res.status(400).json({ error: "VRM required" });

    const vrmUpper = vrm.toUpperCase();

    // 1. Check if user already unlocked this VRM
    const existing = await query(
      `SELECT id FROM unlocked_specs WHERE user_id=$1 AND vrm=$2`,
      [user_id, vrmUpper]
    );

    if (existing.rows.length > 0) {
      // Already unlocked = free forever
      const cached = await query(
        `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
        [vrmUpper]
      );

      return res.json({
        alreadyUnlocked: true,
        price: 0,
        spec: cached.rows[0]?.spec_json || null
      });
    }

    // 2. Check monthly free unlocks for premium users
    const { rows } = await query(
      `SELECT premium, premium_until, monthly_unlocks_remaining FROM users WHERE id=$1`,
      [user_id]
    );

    const user = rows[0];
    const isPremium =
      user.premium &&
      (!user.premium_until || new Date(user.premium_until) > new Date());

    let price = PRICE_STANDARD;
    let remaining = user.monthly_unlocks_remaining;

    // Reset free unlocks monthly if needed
    if (isPremium) {
      remaining = await resetMonthlyIfNeeded(user_id);
    }

    if (isPremium) {
      if (remaining > 0) {
        // Use a free unlock
        price = 0;

        await query(
          `UPDATE users
           SET monthly_unlocks_remaining = monthly_unlocks_remaining - 1
           WHERE id=$1`,
          [user_id]
        );
      } else {
        // Discounted paid unlock
        price = Number((PRICE_STANDARD * (1 - PREMIUM_DISCOUNT)).toFixed(2));
      }
    } else {
      // Free users always pay full price for new VRMs
      price = PRICE_STANDARD;
    }

    // 3. Fetch spec data — first check cache
    let specData;
    const cached = await query(
      `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
      [vrmUpper]
    );

    if (cached.rows.length > 0) {
      specData = cached.rows[0].spec_json;
    } else {
      specData = await fetchSpecDataFromAPI(vrmUpper);

      await query(
        `INSERT INTO vehicle_specs (vrm, spec_json)
         VALUES ($1, $2)
         ON CONFLICT (vrm)
         DO UPDATE SET spec_json = $2, updated_at = NOW()`,
        [vrmUpper, specData]
      );
    }

    // 4. Save unlock record
    await query(
      `INSERT INTO unlocked_specs (user_id, vrm)
       VALUES ($1, $2)`,
      [user_id, vrmUpper]
    );

    return res.json({
      success: true,
      price,
      isPremium,
      remainingFreeUnlocks: isPremium ? Math.max(remaining - 1, 0) : null,
      spec: specData
    });

  } catch (err) {
    console.error("UNLOCK ERROR:", err);
    return res.status(500).json({ error: "Failed to unlock spec" });
  }
});

export default router;
