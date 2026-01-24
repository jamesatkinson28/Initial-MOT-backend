import express from "express";
import { authRequired } from "../middleware/auth.js";
import { query } from "../db/db.js";
import axios from "axios";
import { unlockSpecForUser } from "../services/specUnlock.js";
import { buildCleanSpec } from "../services/specBuilder.js";

const router = express.Router();

const ENABLE_IMAGES = false;


// ------------------------------------------------------------
// OPTIONAL IMAGE FETCHING (DISABLED)
// ------------------------------------------------------------
async function fetchImagesFromVDG(vrm) {
  if (!ENABLE_IMAGES) return null;
  return { main: null, angles: [] };
}

// ------------------------------------------------------------
// FETCH SPEC FROM API
// ------------------------------------------------------------
async function fetchSpecDataFromAPI(vrm) {
  const url = `${process.env.SPEC_API_BASE_URL}/r2/lookup`;

  const response = await axios.get(url, {
    params: {
      ApiKey: process.env.SPEC_API_KEY,
      PackageName: "VehicleDetails",
      Vrm: vrm
    }
  });

  const data = response.data;

  if (!data?.Results?.VehicleDetails) return null;

  const cleanSpec = buildCleanSpec(data.Results);
  cleanSpec.images = await fetchImagesFromVDG(vrm);

  return cleanSpec;
}

// ------------------------------------------------------------
// UNLOCK SPEC ROUTE (AUTHORITATIVE VERSION)
// ------------------------------------------------------------
router.post("/unlock-spec", authRequired, async (req, res) => {
  const client = await query("BEGIN").catch(() => null);

  try {
    const { vrm } = req.body;
    if (!vrm) return res.status(400).json({ error: "VRM required" });

    const vrmUpper = vrm.toUpperCase();
    const user = req.user;
    const user_id = user.id;

    // --------------------------------------------------
    // STEP 1: Already unlocked? (DB is authority)
    // --------------------------------------------------
    const alreadyUnlocked = await query(
      `SELECT 1 FROM unlocked_specs WHERE user_id=$1 AND vrm=$2`,
      [user_id, vrmUpper]
    );

    if (alreadyUnlocked.rowCount > 0) {
      const cached = await query(
        `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
        [vrmUpper]
      );

      const spec =
        cached.rowCount > 0
          ? cached.rows[0].spec_json
          : await fetchSpecDataFromAPI(vrmUpper);

      return res.json({
        success: true,
        alreadyUnlocked: true,
        price: 0,
        saved: true,
        spec
      });
    }

    // --------------------------------------------------
    // STEP 2: Fetch user state
    // --------------------------------------------------
    const userRow = await query(
      `SELECT premium, premium_until, monthly_unlocks_used
       FROM users WHERE id=$1 FOR UPDATE`,
      [user_id]
    );

    const u = userRow.rows[0];
    const isPremium =
      u.premium &&
      (!u.premium_until || new Date(u.premium_until) > new Date());

    let price = 1.49;
    let remainingFreeUnlocks = null;

    if (isPremium) {
      const remaining = Math.max(3 - u.monthly_unlocks_used, 0);
      remainingFreeUnlocks = remaining;

      if (remaining === 0) {
        price = Number((1.49 * 0.75).toFixed(2));
      }
    }

    // --------------------------------------------------
    // STEP 3: Fetch spec
    // --------------------------------------------------
    let cached = await query(
      `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
      [vrmUpper]
    );

	let spec;

	if (cached.rowCount > 0) {
	  spec = cached.rows[0].spec_json;

	  // 🔄 Auto-upgrade EV specs missing new fields
	  const needsUpgrade =
		(spec.engine?.fuel_type === "ELECTRICITY" && !spec.ev?.miles_per_kwh) ||
		(spec.ev && !spec.ev.wltp_range_miles);

	  if (needsUpgrade) {
		spec = await fetchSpecDataFromAPI(vrmUpper);
	  }
	} else {
	  spec = await fetchSpecDataFromAPI(vrmUpper);
	}

	console.log("──────── VEHICLE SPEC DEBUG ────────");
    console.log("VRM:", vrmUpper);
	console.log("SPEC SOURCE:", cached.rowCount > 0 ? "DATABASE" : "API");
	console.log("TOP LEVEL KEYS:", Object.keys(spec || {}));
	console.log("HAS TOWING:", !!spec?.towing, spec?.towing);
	console.log("HAS EV:", !!spec?.ev, spec?.ev);
	console.log("SPEC VERSION:", spec?._meta?.spec_version);
	console.log("────────────────────────────────────");


    if (!spec) {
      await query("ROLLBACK");
      return res.status(404).json({ error: "Vehicle spec not found" });
    }

    // --------------------------------------------------
    // STEP 4: Persist unlock FIRST
    // --------------------------------------------------
    const unlockInsert = await query(
      `INSERT INTO unlocked_specs (user_id, vrm)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING 1`,
      [user_id, vrmUpper]
    );

    // If insert failed, abort (safety net)
    if (unlockInsert.rowCount === 0) {
      await query("ROLLBACK");
      return res.status(409).json({ error: "Unlock already exists" });
    }

    // --------------------------------------------------
    // STEP 5: Increment usage ONLY AFTER successful insert
    // --------------------------------------------------
    if (isPremium && remainingFreeUnlocks > 0) {
      await query(
        `UPDATE users
         SET monthly_unlocks_used = monthly_unlocks_used + 1
         WHERE id=$1`,
        [user_id]
      );
    }

    // --------------------------------------------------
    // STEP 6: Cache spec
    // --------------------------------------------------
    await query(
      `INSERT INTO vehicle_specs (vrm, spec_json)
       VALUES ($1, $2)
       ON CONFLICT (vrm)
       DO UPDATE SET spec_json=$2, updated_at=NOW()`,
      [vrmUpper, spec]
    );

    await query("COMMIT");

    return res.json({
      success: true,
      price,
      isPremium,
      remainingFreeUnlocks:
        remainingFreeUnlocks !== null
          ? Math.max(remainingFreeUnlocks - 1, 0)
          : null,
      saved: true,
      spec
    });

  } catch (err) {
    await query("ROLLBACK");
    console.error("UNLOCK SPEC ERROR:", err);
    res.status(500).json({ error: "Failed to unlock spec" });
  }
});



/**
 * POST /api/spec/unlock
 * body: { vehicle_id }
 * auth: required
 */

// ------------------------------------------------------------
// RESTORE UNLOCKED SPECS (READ-ONLY)
// ------------------------------------------------------------
router.get("/spec/unlocked", authRequired, async (req, res) => {
  try {
    const user_id = req.user.id;

    const result = await query(
      `
      SELECT us.vrm, vs.spec_json
      FROM unlocked_specs us
      JOIN vehicle_specs vs ON vs.vrm = us.vrm
      WHERE us.user_id = $1
      ORDER BY us.unlocked_at DESC
      `,
      [user_id]
    );

    return res.json(
      result.rows.map(row => ({
        reg: row.vrm,
        spec: row.spec_json,
      }))
    );
  } catch (err) {
    console.error("❌ SPEC RESTORE ERROR:", err);
    return res.status(500).json({
      error: "Failed to restore unlocked specs",
    });
  }
});



export default router;