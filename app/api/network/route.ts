import { networkInterfaces, hostname } from "node:os";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter(
      (entry) =>
        entry && entry.family === "IPv4" && !entry.internal && entry.address,
    )
    .map((entry) => entry!.address);
  const lanAddress =
    addresses.find((address) => address.startsWith("172.20.")) ??
    addresses.find((address) => address.startsWith("192.168.")) ??
    addresses.find((address) => address.startsWith("10.")) ??
    addresses[0] ??
    null;

  return NextResponse.json({
    hostname: hostname(),
    lanAddress,
    telemetryUrl: lanAddress ? `http://${lanAddress}:3000/api/telemetry` : null,
    setupAccessPoint: "SurakshaWatch-2048",
    setupPortal: "http://192.168.4.1",
  });
}
