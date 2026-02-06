import express from "express";
import { makeAppleSignedDataVerifier } from "../apple/appleVerifier.js";
import { query } from "../db/db.js";

const router = express.Router();

export async function handleAppleNotification(payload) {
  const type = payload.notificationType;
  const data = payload.data;
  const transaction = data?.signedTransactionInfo;
  const renewal = data?.signedRenewalInfo;

  if (!transaction) return;

  const transactionId = transaction.originalTransactionId;
  const expiresDate = new Date(Number(transaction.expiresDate));
  const productId = transaction.productId;

  switch (type) {
    case "SUBSCRIBED":
    case "DID_RENEW":
    case "INTERACTIVE_RENEWAL":
      await query(
        `
        UPDATE premium_entitlements
        SET premium_until = $1,
            last_event = $2
        WHERE transaction_id = $3
        `,
        [expiresDate, type, transactionId]
      );
      break;

    case "EXPIRED":
    case "DID_FAIL_TO_RENEW":
    case "CANCEL":
      await query(
        `
        UPDATE premium_entitlements
        SET premium_until = NOW(),
            last_event = $1
        WHERE transaction_id = $2
        `,
        [type, transactionId]
      );
      break;

    default:
      // Ignore other events for now
      break;
  }
}
router.post("/", async (req, res) => {
  console.log("🍎 APPLE WEBHOOK HIT", {
    contentType: req.headers["content-type"],
    isBuffer: Buffer.isBuffer(req.body),
    bodyLength: req.body?.length,
  });
  try {
    let signedPayload;

	try {
	  const parsed = JSON.parse(req.body.toString("utf8"));
	  signedPayload = parsed.signedPayload;
	} catch (e) {
	  console.error("APPLE WEBHOOK: invalid JSON");
	  return res.sendStatus(400);
	}

	if (!signedPayload) {
	  console.error("APPLE WEBHOOK: missing signedPayload");
	  return res.sendStatus(400);
	}
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
    // Immediate revocation only
	if (
	  notificationType === "EXPIRED" ||
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

	  console.log("APPLE IAP REVOKED:", notificationType, originalTransactionId);
	  return res.json({ ok: true });
	}

	// Cancellation / billing issue → allow access until expiry
	if (
	  notificationType === "CANCEL" ||
	  notificationType === "DID_FAIL_TO_RENEW"
	) {
	  console.log(
		"APPLE IAP NON-RENEWING:",
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
