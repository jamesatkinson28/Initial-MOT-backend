import express from "express";
import { authRequired } from "../middleware/auth.js";
import { query } from "../db/db.js";
import axios from "axios";

const router = express.Router();

// Pricing
const PRICE_STANDARD = 1.49;
const PREMIUM_DISCOUNT = 0.25; // 25% off

// ------------------------------
// Reset premium unlocks monthly
// ------------------------------
async function resetMonthlyIfNeeded(user_id) {
  const { rows } = await query(
    `SELECT monthly_unlocks_remaining, last_unlock_reset
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
// REAL VDG SPEC API INTEGRATION
// ------------------------------
async function fetchSpecDataFromAPI(vrm) {
  try {
    const url = `${process.env.SPEC_API_BASE_URL}/r2/lookup`;

    const response = await axios.get(url, {
      params: {
        ApiKey: process.env.SPEC_API_KEY,
        PackageName: "VehicleDetails",
        Vrm: vrm
      }
    });

    const data = response.data;

    if (!data || !data.ResponseInformation?.IsSuccessStatusCode) {
      console.log("VDG API returned no valid result:", data);
      return null;
    }

    const vd = data.Results?.VehicleDetails?.VehicleIdentification ?? {};
    const model = data.Results?.ModelDetails?.ModelIdentification ?? {};

    // You can map more fields later but these are the essentials
    const cleaned = {
      vrm: vrm,
      make: vd.DvlaMake || model.Make || "Unknown",
      model: vd.DvlaModel || model.Model || "Unknown",
      engine_size:
        data.Results?.VehicleDetails?.DvlaTechnicalDetails?.EngineCapacityCc ??
        null,
      raw: data, // store everything (optional, can remove)
      fetched_at: new Date().toISOString()
    };

    return cleaned;

  } catch (err) {
    console.error("VDG SPEC API ERROR:", err.response?.data || err);
    return null;
  }
}

// ------------------------------
// UNLOCK SPEC ENDPOINT
// ------------------------------
router.post("/unlock-spec", authRequired, async (req, res) => {
  try {
    const { vrm } = req.body;
    const user_id = req.user.id;

    if (!vrm) return res.status(400).json({ error: "VRM required" });

    const vrmUpper = vrm.toUpperCase();

    // 1. Check if already unlocked
    const existing = await query(
      `SELECT id FROM unlocked_specs WHERE user_id=$1 AND vrm=$2`,
      [user_id, vrmUpper]
    );

    if (existing.rows.length > 0) {
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

    // 2. Get premium info
    const { rows } = await query(
      `SELECT premium, premium_until, monthly_unlocks_remaining 
       FROM users WHERE id=$1`,
      [user_id]
    );

    const user = rows[0];
    const isPremium =
      user.premium &&
      (!user.premium_until || new Date(user.premium_until) > new Date());

    let remaining = isPremium
      ? await resetMonthlyIfNeeded(user_id)
      : null;

    // 3. Pricing rule
    let price = PRICE_STANDARD;

    if (isPremium) {
      if (remaining > 0) {
        price = 0;
        await query(
          `UPDATE users
           SET monthly_unlocks_remaining = monthly_unlocks_remaining - 1
           WHERE id=$1`,
          [user_id]
        );
      } else {
        price = Number((PRICE_STANDARD * (1 - PREMIUM_DISCOUNT)).toFixed(2));
      }
    }

    // 4. Fetch or load cached spec
    let specData;

    const cached = await query(
      `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
      [vrmUpper]
    );

    if (cached.rows.length > 0) {
      specData = cached.rows[0].spec_json;
    } else {
      specData = await fetchSpecDataFromAPI(vrmUpper);

      if (!specData) {
        return res.status(500).json({ error: "Failed to retrieve spec from provider" });
      }

      await query(
        `INSERT INTO vehicle_specs (vrm, spec_json)
         VALUES ($1, $2)
         ON CONFLICT (vrm)
         DO UPDATE SET spec_json=$2, updated_at=NOW()`,
        [vrmUpper, specData]
      );
    }

    // 5. Record unlock
    await query(
      `INSERT INTO unlocked_specs (user_id, vrm) VALUES ($1, $2)`,
      [user_id, vrmUpper]
    );

    // 6. Return spec
    return res.json({
      success: true,
      price,
      isPremium,
      remainingFreeUnlocks: isPremium
        ? Math.max(remaining - (price === 0 ? 1 : 0), 0)
        : null,
      spec: specData
    });

  } catch (err) {
    console.error("UNLOCK SPEC ERROR:", err);
    return res.status(500).json({ error: "Failed to unlock spec" });
  }
});

export default router;
