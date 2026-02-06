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
    // Verify & decode notification
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
    // Extract identifiers
    // --------------------------------------------------
    const originalTransactionId = tx?.originalTransactionId;
    const productId = tx?.productId ?? null;

    if (!originalTransactionId) {
      console.warn(
        "APPLE IAP: Missing originalTransactionId",
        notificationType
      );
      return res.json({ ok: true });
    }

    // --------------------------------------------------
    // Immediate revocation events
    // --------------------------------------------------
    if (notificationType === "EXPIRED" || notificationType === "REFUND") {
	  await query(
		`
		UPDATE premium_entitlements
		SET
		  premium_until = NOW(),
		  status = 'expired',
		  last_notification_type = $2,
		  last_notification_at = NOW()
		WHERE transaction_id = $1
		`,
		[String(originalTransactionId), notificationType]
	  );

	  console.log("APPLE IAP REVOKED:", notificationType, originalTransactionId);
	  return res.json({ ok: true });
	}


    // --------------------------------------------------
    // Non-renewing (grace period allowed)
    // --------------------------------------------------
    if (
      notificationType === "CANCELLED" ||
      notificationType === "DID_FAIL_TO_RENEW"
    ) {
      await query(
        `
        UPDATE premium_entitlements
        SET
          last_notification_type = $2,
          last_notification_at = NOW()
        WHERE transaction_id = $1
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
    // Determine expiry date
    // --------------------------------------------------
    let expiresDateMs =
      tx?.expiresDate ??
      null;

    if (!expiresDateMs && signedRenewalInfo) {
      const renewal =
        await verifier.verifyAndDecodeRenewal(signedRenewalInfo);

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
    // UPSERT entitlement
    // --------------------------------------------------
    await query(
      `
      INSERT INTO premium_entitlements (
        transaction_id,
        premium_until,
        product_id,
        platform,
        last_notification_type,
        last_notification_at
      )
      VALUES (
        $1,
        to_timestamp($2 / 1000.0),
        $3,
        'ios',
        $4,
        NOW()
      )
      ON CONFLICT (transaction_id)
      DO UPDATE SET
        premium_until = EXCLUDED.premium_until,
        product_id = COALESCE(EXCLUDED.product_id, premium_entitlements.product_id),
        platform = 'ios',
        last_notification_type = EXCLUDED.last_notification_type,
        last_notification_at = NOW()
      `,
      [
        String(originalTransactionId),
        Number(expiresDateMs),
        productId,
        notificationType,
      ]
    );

    console.log(
      "APPLE IAP UPDATED:",
      notificationType,
      originalTransactionId,
      new Date(expiresDateMs).toISOString()
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("APPLE NOTIFICATION ERROR:", err);
    return res.status(500).json({ ok: false });
  }
});

export default router;
