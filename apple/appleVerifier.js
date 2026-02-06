import fs from "fs";
import path from "path";
import { SignedDataVerifier, Environment } from "@apple/app-store-server-library";

// ✅ Choose environment
const environment =
  process.env.APPLE_IAP_ENV === "PROD"
    ? Environment.PRODUCTION
    : Environment.SANDBOX;

// ✅ Your iOS bundle id (must match the app sending purchases)
const bundleId = process.env.APPLE_BUNDLE_ID;

// ✅ Required in Production per Apple library docs (set it in env for prod)
const appAppleId =
  environment === Environment.PRODUCTION
    ? Number(process.env.APPLE_APP_APPLE_ID) // e.g. 1234567890
    : undefined;

// ✅ Load Apple Root CAs from local files
function loadAppleRootCAs() {
  const certDir = path.resolve(process.cwd(), "certs");

  const files = (process.env.APPLE_ROOT_CA_FILES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (files.length === 0) {
    throw new Error(
      "Missing APPLE_ROOT_CA_FILES env (comma-separated cert filenames in /certs)"
    );
  }

  return files.map((file) => fs.readFileSync(path.join(certDir, file)));
}

export function makeAppleSignedDataVerifier() {
  if (!bundleId) throw new Error("Missing APPLE_BUNDLE_ID env");

  const appleRootCAs = loadAppleRootCAs();

  // enableOnlineChecks=true lets the verifier do extra checks
  const enableOnlineChecks = environment === Environment.PRODUCTION;

  return new SignedDataVerifier(
    appleRootCAs,
    enableOnlineChecks,
    environment,
    bundleId,
    appAppleId
  );
}

export async function verifyAppleNotification(rawBody) {
  const verifier = makeAppleSignedDataVerifier();

  if (!rawBody?.signedPayload) {
    throw new Error("Missing signedPayload from Apple notification");
  }

  const decodedPayload = await verifier.verifyAndDecodeNotification(
    rawBody.signedPayload
  );

  return decodedPayload;
}