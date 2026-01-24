import express from "express";
import { query } from "../db/db.js";
import { authRequired } from "../middleware/auth.js";
import { verifyAppleReceipt } from "../services/iap/apple.js";
import { verifyGooglePurchase } from "../services/iap/google.js";
import { unlockSpecForUser } from "../services/specUnlock.js";
import axios from "axios";
import { buildCleanSpec } from "../services/specBuilder.js";


async function fetchSpecDataFromAPI(vrm) {
  const url = `${process.env.SPEC_API_BASE_URL}/r2/lookup`;

  const response = await axios.get(url, {
    params: {
      ApiKey: process.env.SPEC_API_KEY,
      PackageName: "VehicleDetails",
      Vrm: vrm,
    },
  });

  const data = response.data;
  if (!data?.Results?.VehicleDetails) return null;

  // IMPORTANT: call the same cleaner as spec.js
  // If buildCleanSpec is not exported yet, see note below
  const cleanSpec = buildCleanSpec(data.Results);
  return cleanSpec;
}

const router = express.Router();

router.post("/spec-unlock", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      vrm,
      free,
      platform,
      receipt,
      purchaseToken,
      productId,
    } = req.body;

    if (!vrm) {
      return res.status(400).json({ success: false, error: "Missing VRM" });
    }

	const vrmUpper = vrm.toUpperCase();

    // 1️⃣ Already unlocked?
    const existing = await query(
      `SELECT 1 FROM unlocked_specs WHERE user_id = $1 AND vrm = $2`,
      [ userId, vrmUpper ]
    );

    if (existing.rows.length > 0) {
	  const spec = await fetchSpecDataFromAPI(vrmUpper);

	  if (!spec) {
		return res.status(404).json({
		  success: false,
		  error: "Vehicle spec not found",
		});
	  }

	  return res.json({
		success: true,
		alreadyUnlocked: true,
		spec,
	  });
	}

    // 2️⃣ FREE unlock path
    if (free === true) {
	  const res = await query(
		`
		UPDATE users
		SET monthly_unlocks_remaining = monthly_unlocks_remaining - 1
		WHERE id = $1
		  AND premium = true
		  AND monthly_unlocks_remaining > 0
		RETURNING monthly_unlocks_remaining
		`,
		[userId]
	  );

	  if (res.rowCount === 0) {
		return res.status(403).json({
		  success: false,
		  error: "No free unlocks remaining",
		});
	  }
    } else {
      // 3️⃣ PAID unlock path — validate store receipt

      if (platform === "ios") {
        const result = await verifyAppleReceipt(receipt);
        if (!result.valid) {
          return res.status(401).json({ success: false, error: "Invalid Apple receipt" });
        }
      }

      if (platform === "android") {
        const result = await verifyGooglePurchase({
          packageName: process.env.GOOGLE_PACKAGE_NAME,
          productId,
          purchaseToken,
        });

        if (!result.valid) {
          return res.status(401).json({ success: false, error: "Invalid Google purchase" });
        }
      }
    }

    // 4️⃣ Unlock spec


    // 4️⃣ Fetch spec
	const spec = await fetchSpecDataFromAPI(vrmUpper);

	if (!spec) {
	  return res.status(404).json({
		success: false,
		error: "Vehicle spec not found",
	  });
	}

	// 5️⃣ Delegate unlock (snapshots + unlocked_specs)
	const result = await unlockSpecForUser({
	  userId,
	  vrm: vrmUpper,
	  spec,
	});

	return res.json({
	  success: true,
	  unlocked: !result.alreadyUnlocked,
	  spec: result.spec ?? spec,
	});
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);
    res.status(500).json({ success: false, error: "Failed to unlock spec" });
  }
});

export default router;
