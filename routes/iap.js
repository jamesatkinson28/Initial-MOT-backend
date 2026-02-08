import express from "express";
import { withTransaction, query } from "../db/db.js";
import { unlockSpec } from "../services/unlockSpec.js";
import { optionalAuth } from "../middleware/auth.js";

const router = express.Router();

/* ------------------------------------------------------------------
   SPEC UNLOCK (unchanged)
------------------------------------------------------------------- */
router.post("/spec-unlock", optionalAuth, async (req, res) => {
  try {
    const { vrm, guestId, transactionId, productId, platform, unlockSource } = req.body;

    console.log("📦 /spec-unlock payload", {
      vrm,
      guestId,
      transactionId,
      productId,
      platform,
      hasUser: !!req.user,
    });

    const result = await withTransaction(async (db) => {
      return unlockSpec({
        db,
        vrm,
        user: req.user ?? null,
        guestId: guestId ?? null,
        transactionId: transactionId ?? null,
        productId: productId ?? null,
        platform: platform ?? null,
		unlockSource: unlockSource ?? (transactionId ? "paid" : "free"),
      });
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);

    const message = err?.message || "";

    if (
      message.toLowerCase().includes("retention") ||
      message.toLowerCase().includes("dvla")
    ) {
      return res.status(409).json({
        success: false,
        retention: true,
        retryAfterDays: 7,
        message:
          "This registration is currently being updated by DVLA. Please try again in a few days.",
      });
    }

    return res.status(500).json({
      success: false,
      error: message || "Failed to unlock specification",
    });
  }
});

/* ------------------------------------------------------------------
   SUBSCRIPTION CLAIM / LINK
------------------------------------------------------------------- */
router.post("/subscription", optionalAuth, async (req, res) => {
  try {
    const { productId, transactionId, originalTransactionId, platform, guestId } = req.body;

    const userUuid = req.user?.id ?? null;
    const gId = guestId ?? req.guestId ?? null;

    if (!userUuid && !gId) {
      return res.status(400).json({ error: "No user or guest identity provided" });
    }

    if (!productId || !transactionId) {
      return res.status(400).json({ error: "Missing productId or transactionId" });
    }

    const originalTx = originalTransactionId ?? transactionId;
    const latestTx = transactionId;

    const interval =
      productId === "garagegpt_premium_yearly"
        ? "1 year"
        : "1 month";

    const entitlementRes = await query(
      `
      INSERT INTO premium_entitlements (
        original_transaction_id,
        transaction_id,
        latest_transaction_id,
        product_id,
        platform,
        user_uuid,
        guest_id,
        premium_until,
        monthly_unlocks_used,
        is_confirmed
      )
      VALUES (
        $1,
        $2,
        $2,
        $3,
        $4,
        $5,
        $6,
        NOW() + INTERVAL '${interval}',
        0,
        false
      )
      ON CONFLICT (original_transaction_id)
      DO UPDATE SET
        latest_transaction_id = EXCLUDED.latest_transaction_id,
        transaction_id       = EXCLUDED.transaction_id,
        product_id           = EXCLUDED.product_id,
        platform             = EXCLUDED.platform,
        user_uuid            = COALESCE(EXCLUDED.user_uuid, premium_entitlements.user_uuid),
        guest_id             = COALESCE(EXCLUDED.guest_id, premium_entitlements.guest_id),
        premium_until        = GREATEST(
                                premium_entitlements.premium_until,
                                EXCLUDED.premium_until
                              ),
        monthly_unlocks_used = 0,
        is_confirmed         = premium_entitlements.is_confirmed
      RETURNING premium_until;
      `,
      [
        originalTx,
        latestTx,
        productId,
        platform ?? "ios",
        userUuid,
        userUuid ? null : gId,
      ]
    );

    const premiumUntil = entitlementRes.rows[0].premium_until;

    if (userUuid) {
      await query(
        `
        UPDATE users
        SET premium = TRUE,
            premium_until = $2,
            monthly_unlocks_used = 0,
            monthly_unlocks_reset_at = NOW()
        WHERE uuid = $1
        `,
        [userUuid, premiumUntil]
      );
    }

    return res.json({ success: true, premium_until: premiumUntil });
  } catch (err) {
    console.error("SUBSCRIPTION ERROR:", err);
    return res.status(500).json({ success: false });
  }
});





export default router;
