import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});

export async function verifyGooglePurchase({
  packageName,
  productId,
  purchaseToken,
}) {
  const client = await auth.getClient();
  const androidpublisher = google.androidpublisher({
    version: "v3",
    auth: client,
  });

  const res = await androidpublisher.purchases.products.get({
    packageName,
    productId,
    token: purchaseToken,
  });

  if (res.data.purchaseState !== 0) {
    return { valid: false };
  }

  return {
    valid: true,
    purchase: res.data,
  };
}
