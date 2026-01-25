import axios from "axios";
import { buildCleanSpec } from "../routes/spec.js";

export async function fetchSpecDataFromAPI(vrm) {
  const url = `${process.env.SPEC_API_BASE_URL}/r2/lookup`;

  const response = await axios.get(url, {
    params: {
      ApiKey: process.env.SPEC_API_KEY,
      PackageName: "VehicleDetails",
      Vrm: vrm
    }
  });

  const data = response.data;

  const statusCode =
    data?.StatusCode ??
    data?.statusCode ??
    data?.Header?.StatusCode ??
    data?.Header?.statusCode ??
    null;

  let cleanSpec = null;

  if (data?.Results?.VehicleDetails) {
    cleanSpec = buildCleanSpec(data.Results);
  }

  return {
    spec: cleanSpec,
    statusCode
  };
}
