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
  try {
    const { originalTransactionId } = req.body;

    const userUuid = req.user?.id ?? null;
    const guestId = req.body.guestId ?? null;

    if (!originalTransactionId) {
      return res.status(400).json({
        error: "Missing originalTransactionId",
      });
    }

    if (!userUuid && !guestId) {
      return res.status(400).json({
        error: "No user or guest identity provided",
      });
    }

    // Link entitlement to user / guest
    const result = await query(
      `
      UPDATE premium_entitlements
      SET
        user_uuid = COALESCE($2, user_uuid),
        guest_id = COALESCE($3, guest_id)
      WHERE original_transaction_id = $1
      RETURNING premium_until
      `,
      [
        originalTransactionId,
        userUuid,
        userUuid ? null : guestId,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Subscription not found yet. Please try again shortly.",
      });
    }

    const premiumUntil = result.rows[0].premium_until;

    // TEMP compatibility: sync users table
    if (userUuid) {
      await query(
        `
        UPDATE users
        SET
          premium = premium_until > NOW(),
          premium_until = $2
        FROM premium_entitlements
        WHERE users.uuid = $1
          AND premium_entitlements.original_transaction_id = $3
        `,
        [userUuid, premiumUntil, originalTransactionId]
      );
    }

    return res.json({
      success: true,
      premium_until: premiumUntil,
    });
  } catch (err) {
    console.error("SUBSCRIPTION CLAIM ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to link subscription",
    });
  }
});

export default router;
