// routes/apple.js
import express from "express";
import { verifyAppleNotification } from "../utils/appleVerifier.js";
import { query } from "../db/db.js";

const router = express.Router();

router.post("/apple/notifications", async (req, res) => {
  try {
    const payload = await verifyAppleNotification(req.body);

    const {
      notificationType,
      data,
    } = payload;

    const tx = data?.signedTransactionInfo;
    if (!tx) return res.sendStatus(200);

    const {
      transactionId,
      originalTransactionId,
      expiresDate,
      productId,
    } = tx;

    // 🔑 Always key by originalTransactionId
    const premiumUntil = expiresDate
      ? new Date(Number(expiresDate))
      : null;

    switch (notificationType) {
      case "DID_RENEW":
      case "INITIAL_BUY":
        await query(
          `
          UPDATE premium_entitlements
          SET
            premium_until = $1,
            status = 'active',
            last_notification_type = $2,
            last_notification_at = NOW()
          WHERE original_transaction_id = $3
          `,
          [premiumUntil, notificationType, originalTransactionId]
        );
        break;

      case "EXPIRED":
        await query(
          `
          UPDATE premium_entitlements
          SET
            status = 'expired',
            premium_until = $1,
            last_notification_type = $2,
            last_notification_at = NOW()
          WHERE original_transaction_id = $3
          `,
          [premiumUntil, notificationType, originalTransactionId]
        );
        break;

      case "CANCEL":
        await query(
          `
          UPDATE premium_entitlements
          SET
            status = 'cancelled',
            last_notification_type = $1,
            last_notification_at = NOW()
          WHERE original_transaction_id = $2
          `,
          [notificationType, originalTransactionId]
        );
        break;

      case "REFUND":
        await query(
          `
          UPDATE premium_entitlements
          SET
            status = 'revoked',
            premium_until = NOW(),
            last_notification_type = $1,
            last_notification_at = NOW()
          WHERE original_transaction_id = $2
          `,
          [notificationType, originalTransactionId]
        );
        break;

      default:
        // ignore others for now
        break;
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("APPLE NOTIFICATION ERROR", err);
    // Apple retries automatically if not 200
    return res.sendStatus(500);
  }
});

export default router;
