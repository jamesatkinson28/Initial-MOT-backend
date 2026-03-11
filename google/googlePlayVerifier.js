import { google } from "googleapis";

const rawServiceAccount = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
  console.error("❌ GOOGLE_PLAY_SERVICE_ACCOUNT is missing");
  throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT is missing");
}

let serviceAccount;

try {
  serviceAccount = JSON.parse(rawServiceAccount);
  console.log("✅ GOOGLE_PLAY_SERVICE_ACCOUNT parsed successfully");
  console.log("🔐 Google service account email:", serviceAccount.client_email);
  console.log("📁 Google project_id:", serviceAccount.project_id);
  console.log("🔑 Private key present:", !!serviceAccount.private_key);
} catch (err) {
  console.error("❌ Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT");
  console.error("Parse error:", err.message);
  throw err;
}

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});

function maskToken(token) {
  if (!token || typeof token !== "string") return null;
  if (token.length <= 12) return token;
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

export async function verifyAndroidSubscription(purchaseToken, subscriptionId) {
  console.log("🟦 verifyAndroidSubscription called");
  console.log("📦 packageName:", "com.jamesorange.garagegpt");
  console.log("🏷️ subscriptionId:", subscriptionId);
  console.log("🎟️ purchaseToken present:", !!purchaseToken);
  console.log("🎟️ purchaseToken preview:", maskToken(purchaseToken));
  console.log("👤 service account:", serviceAccount.client_email);
  console.log("📁 project_id:", serviceAccount.project_id);

  if (!purchaseToken) {
    console.error("❌ Missing purchaseToken");
    throw new Error("Missing purchaseToken");
  }

  if (!subscriptionId) {
    console.error("❌ Missing subscriptionId");
    throw new Error("Missing subscriptionId");
  }

  try {
    console.log("🔐 Getting Google auth client...");
    const authClient = await auth.getClient();
    console.log("✅ Google auth client acquired");

    const androidpublisher = google.androidpublisher({
      version: "v3",
      auth: authClient,
    });

    console.log("📡 Calling Google Play subscriptions.get...");

    const res = await androidpublisher.purchases.subscriptions.get({
      packageName: "com.jamesorange.garagegpt",
      subscriptionId,
      token: purchaseToken,
    });

    console.log("✅ Google Play verification success");
    console.log("📄 Google response:", JSON.stringify(res.data, null, 2));

    return res.data;
  } catch (err) {
    console.error("❌ Google Play verification failed");

    console.error("Error message:", err.message);
    console.error("Error code:", err.code);
    console.error("HTTP status:", err.response?.status);
    console.error("HTTP statusText:", err.response?.statusText);

    if (err.response?.data) {
      console.error(
        "Google error response:",
        JSON.stringify(err.response.data, null, 2)
      );
    }

    if (err.errors) {
      console.error("Google API errors:", JSON.stringify(err.errors, null, 2));
    }

    throw err;
  }
}