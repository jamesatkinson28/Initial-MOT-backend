import express from "express";
import { makeAppleSignedDataVerifier } from "../apple/appleVerifier.js";
import { query } from "../db/db.js";

const router = express.Router();

router.post("/", async (req, res) => {
  console.log("🍎 APPLE WEBHOOK HIT", {
    contentType: req.headers["content-type"],
    isBuffer: Buffer.isBuffer(req.body),
    bodyLength: req.body?.length, 
  });

  try {
    // --------------------------------------------------
    // Parse raw body
    // --------------------------------------------------
    let signedPayload;

    try {
      const parsed = JSON.parse(req.body.toString("utf8"));
      signedPayload = parsed?.signedPayload;
    } catch {
      console.error("APPLE WEBHOOK: invalid JSON");
      return res.sendStatus(400);
    }

    if (!signedPayload) {
      console.error("APPLE WEBHOOK: missing signedPayload");
      return res.sendStatus(400);
    }

    // --------------------------------------------------
    // Verify & decode notification (V2)
    // --------------------------------------------------
    const verifier = makeAppleSignedDataVerifier();
    const decoded = await verifier.verifyAndDecodeNotification(signedPayload);

    const notificationType = decoded?.notificationType;
    const subtype = decoded?.subtype ?? null;
    const data = decoded?.data;

    console.log("🍏 APPLE NOTIFICATION DECODED", {
      notificationType,
      subtype,
    });

    const signedTransactionInfo = data?.signedTransactionInfo;
    const signedRenewalInfo = data?.signedRenewalInfo;

    let tx = null;
    if (signedTransactionInfo) {
      tx = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
    }

    // --------------------------------------------------
    // Extract Apple identifiers
    // --------------------------------------------------
    const originalTransactionId =
	  tx?.originalTransactionId ??
	  null;

	const latestTransactionId =
	  tx?.transactionId ??
	  tx?.latestTransactionId ??
	  null;

	// 🔑 CRITICAL FALLBACK (prevents NOT NULL errors)
	const effectiveTransactionId =
	  latestTransactionId ?? originalTransactionId;

	const productId = tx?.productId ?? null;

	if (!effectiveTransactionId) {
	  console.warn(
		"APPLE IAP: Missing transaction identifiers",
		notificationType
	  );
	  return res.json({ ok: true });
	}


	// 🔑 Period transaction ID for refund/revoke
	const refundedTransactionId =
	  tx?.transactionId ?? null;
	  
	// --------------------------------------------------
	// IMMEDIATE REVOCATION (refund / revoke)
	// --------------------------------------------------
	if (
	  notificationType === "REFUND" ||
	  notificationType === "REVOKE"
	) {
	  // 1️⃣ Revoke premium going forward
	  await query(
		`
		UPDATE premium_entitlements
		SET
		  premium_until = LEAST(premium_until, NOW()),
		  status = 'revoked',
		  last_notification_type = $2,
		  last_notification_at = NOW()
		WHERE original_transaction_id = $1
		`,
		[String(originalTransactionId), notificationType]
	  );

	  // 2️⃣ Revoke ONLY free unlocks from the refunded billing period
	  if (refundedTransactionId) {
		await query(
		  `
		  UPDATE unlocked_specs
		  SET
			revoked_at = NOW(),
			revoked_reason = 'subscription_refund'
		  WHERE
			unlock_type = 'free'
			AND entitlement_transaction_id = $1
			AND revoked_at IS NULL
		  `,
		  [String(refundedTransactionId)]
		);
	  }

	  console.log(
		"APPLE IAP REVOKED:",
		notificationType,
		"original:",
		originalTransactionId,
		"period:",
		refundedTransactionId
	  );

	  return res.json({ ok: true });
	}

    // --------------------------------------------------
    // FULL EXPIRY
    // --------------------------------------------------
    if (notificationType === "EXPIRED") {
      await query(
        `
        UPDATE premium_entitlements
        SET
          premium_until = LEAST(premium_until, NOW()),
          status = 'expired',
          last_notification_type = $2,
          last_notification_at = NOW()
        WHERE original_transaction_id = $1
        `,
        [String(originalTransactionId), notificationType]
      );

      console.log("APPLE IAP EXPIRED:", originalTransactionId);
      return res.json({ ok: true });
    }

    // --------------------------------------------------
    // CANCELLED / BILLING FAILURE (no access change)
    // --------------------------------------------------
    if (
      notificationType === "CANCELLED" ||
      notificationType === "DID_FAIL_TO_RENEW"
    ) {
      await query(
        `
        UPDATE premium_entitlements
        SET
          status = 'cancelled',
          last_notification_type = $2,
          last_notification_at = NOW()
        WHERE original_transaction_id = $1
        `,
        [String(originalTransactionId), notificationType]
      );

      console.log(
        "APPLE IAP NON-RENEWING:",
        notificationType,
        originalTransactionId
      );
      return res.json({ ok: true });
    }

    // --------------------------------------------------
    // METADATA-ONLY EVENTS
    // --------------------------------------------------
    if (
      notificationType === "DID_CHANGE_RENEWAL_STATUS" ||
      notificationType === "PRICE_INCREASE"
    ) {
      await query(
        `
        UPDATE premium_entitlements
        SET
          last_notification_type = $2,
          last_notification_at = NOW()
        WHERE original_transaction_id = $1
        `,
        [String(originalTransactionId), notificationType]
      );

      return res.json({ ok: true });
    }

    // --------------------------------------------------
    // DETERMINE EXPIRY (INITIAL_BUY / DID_RENEW / PLAN CHANGE)
    // --------------------------------------------------
    let expiresDateMs = tx?.expiresDate ?? null;

    if (!expiresDateMs && signedRenewalInfo) {
      const renewal = await verifier.verifyAndDecodeRenewal(signedRenewalInfo);
      expiresDateMs =
        renewal?.expiresDate ??
        renewal?.renewalDate ??
        null;
    }

    if (!expiresDateMs) {
      console.warn(
        "APPLE IAP: No expiry date found",
        notificationType,
        originalTransactionId
      );
      return res.json({ ok: true });
    }

    // --------------------------------------------------
    // UPSERT ENTITLEMENT (buy / renew / plan change)
    // --------------------------------------------------
    await query(
      `
      INSERT INTO premium_entitlements (
	    transaction_id,
	    latest_transaction_id,
	    original_transaction_id,
	    premium_until,
	    product_id,
	    platform,
	    status,
		is_confirmed,
	    last_notification_type,
	    last_notification_at
	  )
      VALUES (
	    $1,
	    $2,
	    $3,
	    to_timestamp($4 / 1000.0),
	    $5,
	    'ios',
	    'active',
		true,
	    $6,
	   NOW()
	  )

      ON CONFLICT (original_transaction_id)
	  DO UPDATE SET
	    latest_transaction_id = EXCLUDED.latest_transaction_id,
	    premium_until = GREATEST(
	  	  premium_entitlements.premium_until,
		  EXCLUDED.premium_until
	    ),
	    product_id = COALESCE(EXCLUDED.product_id, premium_entitlements.product_id),
	    platform = 'ios',
	    status = 'active',
		is_confirmed = true,
	    last_notification_type = EXCLUDED.last_notification_type,
	    last_notification_at = NOW()
      `,
      [
	    String(effectiveTransactionId),                 // transaction_id (NOT NULL)
	    String(latestTransactionId ?? effectiveTransactionId),
	    String(originalTransactionId ?? effectiveTransactionId),
	    Number(expiresDateMs),
	    productId,
	    notificationType,
	  ]

    );

    console.log(
	  "APPLE IAP UPDATED:",
	  notificationType,
	  originalTransactionId,
	  latestTransactionId ?? effectiveTransactionId,
	  new Date(expiresDateMs).toISOString()
	);


    return res.json({ ok: true });
  } catch (err) {
    console.error("APPLE NOTIFICATION ERROR:", err);
    return res.status(500).json({ ok: false });
  }
});

export default router;
