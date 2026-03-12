import express from "express";
import { withTransaction, query } from "../db/db.js";
import { unlockSpec } from "../services/unlockSpec.js";
import { optionalAuth } from "../middleware/auth.js";
import { verifyAndroidSubscription } from "../google/googlePlayVerifier.js";

const router = express.Router();

/* ------------------------------------------------------------------
   SPEC UNLOCK (unchanged)
------------------------------------------------------------------- */
// iap.js
router.post("/spec-unlock", optionalAuth, async (req, res) => {
  try {
    const {
      vrm,
      guestId,
      transactionId,
      productId,
      platform,
      unlockSource, // "free" | "paid"
    } = req.body;

    const userUuid = req.user?.id ?? null;
    const resolvedGuestId = guestId ?? req.guestId ?? null;

    if (!vrm) {
      return res.status(400).json({ success: false, error: "VRM required" });
    }

    if (!unlockSource || (unlockSource !== "free" && unlockSource !== "paid")) {
      return res.status(400).json({
        success: false,
        error: "unlockSource is required (free | paid)",
      });
    }

    if (!userUuid && !resolvedGuestId) {
      return res.status(400).json({
        success: false,
        error: "No user or guest identity provided",
      });
    }

    // Only grant +1 credit for a real fresh store purchase
    if (transactionId && productId) {
      await query(
        `
        INSERT INTO unlock_credits_ledger
          (user_uuid, guest_id, transaction_id, platform, product_id, delta, reason)
        VALUES ($1,$2,$3,$4,$5,1,'iap_purchase')
        ON CONFLICT DO NOTHING
        `,
        [
          userUuid,
          userUuid ? null : resolvedGuestId,
          String(transactionId),
          platform ?? null,
          productId,
        ]
      );
    }

    const result = await withTransaction(async (db) => {
      return unlockSpec({
        db,
        vrm,
        user: req.user ?? null,
        guestId: resolvedGuestId,
        transactionId: transactionId ?? null,
        productId: productId ?? null,
        platform: platform ?? null,
        unlockSource,
      });
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ IAP SPEC UNLOCK ERROR:", err);
    const message = err?.message || "";

    if (message === "RETENTION_WAIT") {
      return res.status(409).json({
        success: false,
        retention: true,
        retryAfterDays: 7,
        message:
          "This registration is currently awaiting DVLA update. Please retry after the next weekly update.",
      });
    }

    if (message === "SPEC_NULL") {
      return res.status(422).json({
        success: false,
        refund: true,
        creditKept: true,
        message:
          "No specification data was returned for this registration. You won’t lose this unlock — you can use it on another vehicle.",
      });
    }

    if (message === "Premium subscription required") {
      return res.status(403).json({
        success: false,
        message: "Premium subscription required",
      });
    }

    if (message === "Monthly free unlock limit reached") {
      return res.status(403).json({
        success: false,
        message: "Monthly free unlock limit reached",
      });
    }

    if (message === "RETENTION_PAID_REQUIRED") {
      return res.status(402).json({
        success: false,
        retention: true,
        paidRequired: true,
        message:
          "Your free retry has been used. Please use a paid unlock to retry this registration.",
      });
    }

    if (message === "NO_UNLOCK_CREDIT") {
      return res.status(402).json({
        success: false,
        message: "No unlock credit available.",
      });
    }

    if (message === "UNLOCK_SOURCE_REQUIRED") {
      return res.status(400).json({
        success: false,
        message: "unlockSource is required",
      });
    }

    return res.status(500).json({
      success: false,
      error: message || "Failed to unlock specification",
    });
  }
});
/* ------------------------------------------------------------------
   SUBSCRIPTION CLAIM / LINK (HARDENED)
------------------------------------------------------------------- */
router.post("/subscription", optionalAuth, async (req, res) => {
  try {
	 console.log("📩 /iap/subscription request received", {
      body: req.body,
      user: req.user?.id ?? null,
      guest: req.body?.guestId ?? null,
    }); 
    const {
      productId,
      transactionId,
      originalTransactionId,
      platform,
      guestId,
    } = req.body;

    const userUuid = req.user?.id ?? null;
    const gId = guestId ?? req.guestId ?? null;
	
	console.log("👤 Identity resolved", {
	  userUuid,
	  guestId: gId,
	});

    if (!userUuid && !gId) {
      return res.status(400).json({
        error: "No user or guest identity provided",
      });
    }

    if (!productId || !transactionId) {
      return res.status(400).json({
        error: "Missing productId or transactionId",
      });
    }
	
	// ------------------------------------------------------------
	// 🤖 Verify Android purchase with Google Play
	// ------------------------------------------------------------
	if (platform === "android") {
	  try {
		  
		console.log("🤖 Verifying Android purchase", {
		  productId,
		  transactionId,
		});  
		const verification = await verifyAndroidSubscription(
		  transactionId,
		  productId
		);

		const expiry = Number(verification.expiryTimeMillis);
		console.log("📦 Google verification response", verification);

		if (!expiry) {
		  return res.status(400).json({
			error: "Invalid Android purchase",
		  });
		}

		req.androidExpiry = expiry;
		
		console.log("✅ ANDROID PURCHASE VERIFIED", {
		  productId,
		  transactionId,
		  expiry,
		});

	  } catch (err) {
		console.error("❌ ANDROID VERIFICATION FAILED:", err);

		return res.status(400).json({
		  error: "Android purchase verification failed",
		});
	  }
	}

    const originalTx = originalTransactionId ?? transactionId;
    const latestTx = transactionId;

    const interval =
      productId === "garagegpt_premium_yearly"
        ? "1 year"
        : "1 month";

    // ------------------------------------------------------------
    // 🔒 Check if entitlement already exists
    // ------------------------------------------------------------
    const existingRes = await query(
      `
      SELECT user_uuid, guest_id
      FROM premium_entitlements
      WHERE original_transaction_id = $1
      LIMIT 1
      `,
      [originalTx]
    );

    const existing = existingRes.rows[0] ?? null;

    // ------------------------------------------------------------
    // 🔒 Prevent guest restoring a user-owned subscription
    // ------------------------------------------------------------
    if (existing?.user_uuid && !userUuid) {
      return res.status(403).json({
        error: "Please sign in to restore this subscription.",
      });
    }

    // ------------------------------------------------------------
    // Insert or safely update entitlement
    // ------------------------------------------------------------
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
        monthly_unlocks_reset_at,
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
        CASE
		  WHEN $4 = 'android'
		  THEN to_timestamp($7 / 1000.0)
		  ELSE NOW() + INTERVAL '${interval}'
		END,
        0,
        NOW(),
        false
      )
      ON CONFLICT (original_transaction_id)
      DO UPDATE SET
        latest_transaction_id = EXCLUDED.latest_transaction_id,
        transaction_id        = EXCLUDED.transaction_id,
        product_id            = EXCLUDED.product_id,
        platform              = EXCLUDED.platform,
		
		 -- ✅ Reactivate if previously orphaned
		status                = 'active',

        -- 👤 Lock ownership properly
        user_uuid = COALESCE(
          premium_entitlements.user_uuid,
          EXCLUDED.user_uuid
        ),

        guest_id = CASE
		  WHEN premium_entitlements.user_uuid IS NOT NULL
			THEN NULL
		  ELSE COALESCE(EXCLUDED.guest_id, premium_entitlements.guest_id)
		END,

        -- ⏳ Only extend time, never shorten
        premium_until = GREATEST(
          premium_entitlements.premium_until,
          EXCLUDED.premium_until
        ),

        -- 🚫 DO NOT reset unlocks on restore
        monthly_unlocks_used =
          premium_entitlements.monthly_unlocks_used,

        monthly_unlocks_reset_at =
          premium_entitlements.monthly_unlocks_reset_at,

        is_confirmed = premium_entitlements.is_confirmed
      RETURNING premium_until;
      `,
      [
        originalTx,
        latestTx,
        productId,
        platform ?? "ios",
        userUuid,
        userUuid ? null : gId,
		req.androidExpiry ?? null,
      ]
    );

    const premiumUntil = entitlementRes.rows[0].premium_until;

    // ------------------------------------------------------------
    // Update users table (without resetting unlock counters)
    // ------------------------------------------------------------
    if (userUuid) {
      await query(
        `
        UPDATE users
        SET premium = TRUE,
            premium_until = $2
        WHERE uuid = $1
        `,
        [userUuid, premiumUntil]
      );
    }
	
	console.log("✅ Subscription processed successfully", {
	  premiumUntil,
	  productId,
	  platform,
	});

    return res.json({
      success: true,
      premium_until: premiumUntil,
    });
  } catch (err) {
    console.error("🔥 SUBSCRIPTION ROUTE ERROR", {
	  error: err,
	  body: req.body,
	});
    return res.status(500).json({ success: false });
  }
});





export default router;
