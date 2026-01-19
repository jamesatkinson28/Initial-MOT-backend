import express from "express";
import { query } from "../db/db.js";
import { authRequired } from "../middleware/auth.js";
import { verifyAppleReceipt } from "../services/iap/apple.js";
import { verifyGooglePurchase } from "../services/iap/google.js";

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

    // 🔁 Reset monthly unlocks if new cycle
    await maybeResetMonthlyUnlocks(userId);

    // 1️⃣ Already unlocked?
    const existing = await query(
      `SELECT 1 FROM unlocked_specs WHERE user_id = $1 AND vrm = $2`,
      [userId, vrm]
    );

    if (existing.rows.length > 0) {
      return res.json({ success: true, alreadyUnlocked: true });
    }

    // 2️⃣ FREE unlock path
    if (free === true) {
      await query(
        `UPDATE users
         SET monthly_unlocks_used = monthly_unlocks_used + 1
         WHERE id = $1`,
        [userId]
      );
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
    await query(
      `INSERT INTO unlocked_specs (user_id, vrm)
       VALUES ($1, $2)`,
      [userId, vrm]
    );

    return res.json({ success: true, unlocked: true });
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);
    res.status(500).json({ success: false, error: "Failed to unlock spec" });
  }
});

export default router;
