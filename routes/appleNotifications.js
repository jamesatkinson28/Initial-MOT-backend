import express from "express";
import { makeAppleSignedDataVerifier } from "../apple/appleVerifier.js";
import { query } from "../db/db.js";

const router = express.Router();

router.post("/iap/apple/notifications", async (req, res) => {
  try {
    const { signedPayload } = req.body || {};
    if (!signedPayload) {
      return res.status(400).json({ ok: false, error: "Missing signedPayload" });
    }

    const verifier = makeAppleSignedDataVerifier();

    // --------------------------------------------------
    // Verify + decode notification
    // --------------------------------------------------
    const decoded = await verifier.verifyAndDecodeNotification(signedPayload);

    const notificationType = decoded?.notificationType;
    const data = decoded?.data;

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
      console.warn("APPLE IAP: Missing originalTransactionId", notificationType);
      return res.json({ ok: true }); // stop Apple retry loop
    }

    // --------------------------------------------------
    // Handle cancellations / expiry / failures
    // --------------------------------------------------
    if (
      notificationType === "EXPIRED" ||
      notificationType === "DID_FAIL_TO_RENEW" ||
      notificationType === "CANCEL" ||
      notificationType === "REFUND"
    ) {
      await query(
        `
        UPDATE premium_entitlements
        SET premium_until = NOW()
        WHERE transaction_id = $1
        `,
        [String(originalTransactionId)]
      );

      console.log(
        "APPLE IAP REVOKED:",
        notificationType,
        originalTransactionId
      );

      return res.json({ ok: true });
    }

    // --------------------------------------------------
    // Determine expiry date (renewal OR transaction)
    // --------------------------------------------------
    let expiresDateMs = tx?.expiresDate ?? null;

    if (!expiresDateMs && signedRenewalInfo) {
      const renewal =
        await verifier.verifyAndDecodeRenewal(signedRenewalInfo);
      expiresDateMs = renewal?.renewalDate ?? null;
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
    // UPSERT premium entitlement
    // --------------------------------------------------
    await query(
      `
      INSERT INTO premium_entitlements (
        transaction_id,
        premium_until,
        product_id,
        platform
      )
      VALUES ($1, to_timestamp($2 / 1000.0), $3, 'ios')
      ON CONFLICT (transaction_id)
      DO UPDATE SET
        premium_until = EXCLUDED.premium_until,
        product_id = COALESCE(EXCLUDED.product_id, premium_entitlements.product_id),
        platform = 'ios'
      `,
      [String(originalTransactionId), Number(expiresDateMs), productId]
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

    // During setup it's OK to 500 to force retries.
    // Once stable, consider always returning 200.
    return res.status(500).json({ ok: false });
  }
});

export default router;
