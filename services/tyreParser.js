import axios from "axios";

export function buildTyreConfigurations(payload) {
  const list =
    payload?.Results?.TyreDetails?.TyreDetailsList ?? [];


  return list.map(item => ({
    wheel_inches:
      item?.Front?.Tyre?.RimDiameterInches ??
      item?.Rear?.Tyre?.RimDiameterInches ??
      null,

    front: item?.Front?.Tyre
      ? {
          size: item.Front.Tyre.SizeDescription,
          load_index: item.Front.Tyre.LoadIndex,
          speed_index: item.Front.Tyre.SpeedIndex,
          pressure: {
            normal:
              item.Front.Tyre.Pressure?.TyrePressure ?? null,
            laden:
              item.Front.Tyre.Pressure?.TyrePressureLaden ?? null,
          },
        }
      : null,

    rear: item?.Rear?.Tyre
      ? {
          size: item.Rear.Tyre.SizeDescription,
          load_index: item.Rear.Tyre.LoadIndex,
          speed_index: item.Rear.Tyre.SpeedIndex,
          pressure: {
            normal:
              item.Rear.Tyre.Pressure?.TyrePressure ?? null,
            laden:
              item.Rear.Tyre.Pressure?.TyrePressureLaden ?? null,
          },
        }
      : null,

    rim: item?.Front?.Rim ?? null,
    hub: item?.Hub ?? null,
    fixing: item?.Fixing ?? null,
  }));
}

export async function fetchTyreDetails(vrm) {
  const res = await axios.get(
    `${process.env.SPEC_API_BASE_URL}/r2/lookup`,
    {
      params: {
        ApiKey: process.env.SPEC_API_KEY,
        PackageName: "TyreDetails",
        Vrm: vrm,
      },
    }
  );
// 🛞 DEBUG LOGS — PUT HERE
console.log(
  "🛞 TyreDetailsList length:",
  res.data?.Results?.TyreDetails?.TyreDetailsList?.length
);

console.log(
  "🛞 TyreDetails keys:",
  Object.keys(res.data?.Results?.TyreDetails || {})
);
  return buildTyreConfigurations(res.data);
}
