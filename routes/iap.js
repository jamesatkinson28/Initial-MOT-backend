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
    const { vrm, guestId, transactionId, productId, platform } = req.body;

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
  console.log("📥 /subscription payload:", req.body);

  try {
    const userUuid = req.user?.id ?? null;
    const guestId = req.body.guestId ?? null;

    const originalTransactionId =
      req.body.originalTransactionId ??
      req.body.original_transaction_id ??
      null;

    const latestTransactionId =
      req.body.transactionId ??
      req.body.latestTransactionId ??
      req.body.latest_transaction_id ??
      null;

    console.log("🔎 Parsed identifiers:", {
      originalTransactionId,
      latestTransactionId,
      userUuid,
      guestId,
    });

    // 🚨 Guard 1: must have some transaction identifier
    if (!originalTransactionId && !latestTransactionId) {
      console.warn("❌ No transaction identifiers provided");
      return res.status(400).json({
        error: "Missing transaction identifiers",
      });
    }

    // 🚨 Guard 2: must have identity to link to
    if (!userUuid && !guestId) {
      console.warn("❌ No user or guest identity provided");
      return res.status(400).json({
        error: "No user or guest identity provided",
      });
    }

    const lookupId = originalTransactionId ?? latestTransactionId;
    console.log("🔗 Attempting entitlement match using:", lookupId);

    const result = await query(
      `
      UPDATE premium_entitlements
      SET
        user_uuid = COALESCE($2, user_uuid),
        guest_id = COALESCE($3, guest_id)
      WHERE original_transaction_id = $1
         OR latest_transaction_id = $1
      RETURNING id, original_transaction_id, premium_until
      `,
      [String(lookupId), userUuid, userUuid ? null : guestId]
    );

    if (result.rowCount === 0) {
      console.warn("⏳ No entitlement found yet for:", lookupId);
      return res.status(404).json({
        error: "Subscription not found yet. Apple may still be processing.",
      });
    }

    const { premium_until, original_transaction_id } = result.rows[0];

    console.log("✅ Entitlement linked:", {
      premium_until,
      original_transaction_id,
    });

    // Optional compatibility sync
    if (userUuid) {
      await query(
        `
        UPDATE users
        SET
          premium = $2 > NOW(),
          premium_until = $2
        WHERE uuid = $1
        `,
        [userUuid, premium_until]
      );

      console.log("👤 User premium synced:", userUuid);
    }

    return res.json({
      success: true,
      premium_until,
      original_transaction_id,
    });
  } catch (err) {
    console.error("🔥 SUBSCRIPTION CLAIM ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Failed to link subscription",
    });
  }
});



export default router;
