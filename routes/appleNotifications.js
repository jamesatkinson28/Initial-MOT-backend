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

    // ✅ Verify + decode the notification
    const decoded = await verifier.verifyAndDecodeNotification(signedPayload);

    // The v2 payload contains nested signedTransactionInfo / signedRenewalInfo
    const data = decoded?.data;
    const signedTransactionInfo = data?.signedTransactionInfo;
    const signedRenewalInfo = data?.signedRenewalInfo;

    let tx = null;
    if (signedTransactionInfo) {
      tx = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
    }

    // ✅ Pull key fields
    const originalTransactionId = tx?.originalTransactionId;
    const expiresDateMs = tx?.expiresDate; // ms timestamp in Apple signed data (common)
    const productId = tx?.productId;

    if (!originalTransactionId) {
      // Still return 200 so Apple stops retrying, but log it
      console.warn("Apple notification missing originalTransactionId");
      return res.json({ ok: true });
    }

    // ✅ Update entitlement
    // Rule: premium is active when premium_until > NOW()
    // So on renewals we push premium_until forward
    if (expiresDateMs) {
      await query(
        `
        UPDATE premium_entitlements
        SET premium_until = to_timestamp($2 / 1000.0),
            product_id = COALESCE($3, product_id),
            platform = 'ios'
        WHERE transaction_id = $1
        `,
        [String(originalTransactionId), Number(expiresDateMs), productId || null]
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("APPLE NOTIFICATION ERROR:", err);
    // Apple expects 200s often; but returning 500 makes Apple retry.
    // During setup, 500 is useful; later you may choose 200 to prevent retry storms.
    return res.status(500).json({ ok: false });
  }
});

export default router;
