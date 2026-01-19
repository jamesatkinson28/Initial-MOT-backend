import axios from "axios";

const APPLE_PRODUCTION = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_SANDBOX = "https://sandbox.itunes.apple.com/verifyReceipt";

export async function verifyAppleReceipt(receipt) {
  const payload = {
    "receipt-data": receipt,
    password: process.env.APPLE_SHARED_SECRET,
  };

  try {
    let res = await axios.post(APPLE_PRODUCTION, payload);

    // If sandbox receipt sent to prod
    if (res.data.status === 21007) {
      res = await axios.post(APPLE_SANDBOX, payload);
    }

    if (res.data.status !== 0) {
      throw new Error(`Apple receipt invalid: ${res.data.status}`);
    }

    return {
      valid: true,
      receipt: res.data,
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
