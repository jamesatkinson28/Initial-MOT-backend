import { google } from "googleapis";
import serviceAccount from "./googlePlayServiceAccount.json" assert { type: "json" };

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});

export async function verifyAndroidSubscription(purchaseToken, subscriptionId) {
  const authClient = await auth.getClient();

  const androidpublisher = google.androidpublisher({
    version: "v3",
    auth: authClient,
  });

  const res = await androidpublisher.purchases.subscriptions.get({
    packageName: "com.jamesorange.garagegpt",
    subscriptionId,
    token: purchaseToken,
  });

  return res.data;
}