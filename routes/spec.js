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

  try {
    const { vrm } = req.body;
    if (!vrm) return res.status(400).json({ error: "VRM required" });

    const vrmUpper = vrm.toUpperCase();
    const user = req.user;
    const user_id = user.id;


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
	  return res.status(404).json({ error: "Vehicle spec not found" });
	}
	
	const result = await unlockSpecForUser({
	  userId: user_id,
	  vrm: vrmUpper,
	  spec,
	});

	// ✅ Restore old Step-6 invariant: always cache a real spec
	const finalSpec = result.spec || spec;

	if (!finalSpec) {
	  throw new Error("Invariant violated: no spec available to cache");
	}

	// 🔁 Cache spec for frontend + restore
	await query(
	  `
	  INSERT INTO vehicle_specs (vrm, spec_json)
	  VALUES ($1, $2)
	  ON CONFLICT (vrm)
	  DO UPDATE SET spec_json = EXCLUDED.spec_json, updated_at = NOW()
	  `,
	  [vrmUpper, finalSpec]
	);

	if (result.alreadyUnlocked) {
	  return res.json({
		success: true,
		alreadyUnlocked: true,
		spec: finalSpec,
	  });
	}

	return res.json({
	  success: true,
	  saved: true,
	  spec: finalSpec,
	});

  } catch (err) {
    console.error("UNLOCK SPEC ERROR:", err);
    res.status(500).json({ error: "Failed to unlock spec" });
  }
});

export default router;