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
	
	 if (transactionId && productId) {
      await query(
        `
        INSERT INTO unlock_credits_ledger
          (user_uuid, guest_id, transaction_id, platform, product_id, delta, reason)
        VALUES ($1,$2,$3,$4,$5,1,'iap_purchase')
        ON CONFLICT DO NOTHING
        `,
        [
          req.user?.id ?? null,
          req.user ? null : (guestId ?? null),
          String(transactionId),
          platform ?? null,
          productId,
        ]
      );

      console.log("💳 IAP credit granted (if not already)");
    }

    const result = await withTransaction(async (db) => {
      return unlockSpec({
        db,
        vrm,
        user: req.user ?? null,
        guestId: guestId ?? null,
        transactionId: transactionId ?? null,
        productId: productId ?? null,
        platform: platform ?? null,
		unlockSource: null,
      });
    });

    return res.json({ success: true, ...result });
  } catch (err) {
	  console.error("❌ IAP SPEC UNLOCK ERROR:", err);

	  const message = err?.message || "";

	  // ⛔ Still inside retention window
	  if (message === "RETENTION_WAIT") {
		return res.status(409).json({
		  success: false,
		  retention: true,
		  retryAfterDays: 7,
		  message:
			"This registration is currently awaiting DVLA update. Please retry after the next weekly update."
		});
	  }

	  // 💰 Provider returned no spec (eligible for make-good credit if paid)
	  if (message === "SPEC_NULL") {
	    return res.status(422).json({
	  	  success: false,
		  refund: true,          // optional: keep for UI
		  creditKept: true,      // ✅ important
		  message:
		    "No specification data was returned for this registration. You won’t lose this unlock — you can use it on another vehicle.",
	    });
	  }

	  // 🔒 Premium required
	  if (message === "Premium subscription required") {
		return res.status(403).json({
		  success: false,
		  message: "Premium subscription required"
		});
	  }

	  // 📉 Monthly free limit hit
	  if (message === "Monthly free unlock limit reached") {
		return res.status(403).json({
		  success: false,
		  message: "Monthly free unlock limit reached"
		});
	  }
	  
	  if (message === "RETENTION_PAID_REQUIRED") {
	    return res.status(402).json({
		  success: false,
		  retention: true,
		  paidRequired: true,
		  message: "Your free retry has been used. Please use a paid unlock to retry this registration."
	    });
	  }
	  
	  if (message === "NO_UNLOCK_CREDIT") {
	    return res.status(402).json({
		  success: false,
		  message: "No unlock credit available for this purchase.",
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
