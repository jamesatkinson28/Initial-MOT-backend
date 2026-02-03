import express from "express";
import fetch from "node-fetch";
import { withTransaction } from "../db/db.js";
import { unlockSpec } from "../services/unlockSpec.js";
import { optionalAuth } from "../middleware/auth.js";


const router = express.Router();

router.post(
  "/spec-unlock",
  optionalAuth,
  async (req, res) => {
  try {
    const { vrm, guestId, transactionId, productId, platform } = req.body;
	console.log("📦 /spec-unlock payload", {
      vrm,
      guestId,
      transactionId,
      productId,
      platform,
      hasUser: !!req.user,
    });
    console.log("➡️ /spec-unlock hit", {
      vrm,
      hasUser: !!req.user,
      guestId,
      transactionId,
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
      });
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);

    const message = err?.message || "";

    if (
      message.toLowerCase().includes("retention") ||
      message.toLowerCase().includes("dvla") ||
      message.toLowerCase().includes("temporarily unavailable")
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

router.post("/subscription", optionalAuth, async (req, res) => {
  try {
    const { productId, transactionId, platform, guestId } = req.body;

    const userUuid = req.user?.id ?? null;
    const gId = guestId ?? req.guestId ?? null;

    if (!userUuid && !gId) {
      return res.status(400).json({ error: "No user or guest identity provided" });
    }

    if (!productId || !transactionId) {
      return res.status(400).json({ error: "Missing productId or transactionId" });
    }

    // Decide duration
    const interval =
      productId === "garagegpt_premium_yearly" ? "1 year" : "1 month";

    // Create a simple entitlement record (you can upgrade this later)
    await query(
      `
      INSERT INTO premium_entitlements
        (transaction_id, product_id, platform, user_uuid, guest_id, premium_until)
      VALUES
        ($1, $2, $3, $4, $5, NOW() + INTERVAL '${interval}')
      ON CONFLICT (transaction_id)
      DO UPDATE SET
        product_id = EXCLUDED.product_id,
        platform = EXCLUDED.platform,
        user_uuid = COALESCE(EXCLUDED.user_uuid, premium_entitlements.user_uuid),
        guest_id = COALESCE(EXCLUDED.guest_id, premium_entitlements.guest_id),
        premium_until = GREATEST(premium_entitlements.premium_until, EXCLUDED.premium_until)
      `,
      [transactionId, productId, platform ?? "ios", userUuid, userUuid ? null : gId]
    );

    // Optional: if logged-in, also set users.premium temporarily (until you move fully to entitlements)
    if (userUuid) {
      await query(
        `
        UPDATE users
        SET premium = TRUE,
            premium_until = NOW() + INTERVAL '${interval}'
        WHERE uuid = $1
        `,
        [userUuid]
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("SUBSCRIPTION ERROR:", err);
    return res.status(500).json({ error: "Failed to activate subscription" });
  }
});

export default router;
