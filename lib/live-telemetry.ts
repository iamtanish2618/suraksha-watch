export type LiveTelemetry = {
  receivedAt: string;
  wearing: boolean;
  reading: Record<string, unknown>;
};

const liveGlobal = globalThis as unknown as {
  surakshaLiveTelemetry?: Map<string, LiveTelemetry>;
};

const liveTelemetry =
  liveGlobal.surakshaLiveTelemetry ?? new Map<string, LiveTelemetry>();

liveGlobal.surakshaLiveTelemetry = liveTelemetry;

export function setLiveTelemetry(deviceId: string, packet: LiveTelemetry) {
  liveTelemetry.set(deviceId, packet);
}

export function getLiveTelemetry(deviceId?: string | null) {
  if (deviceId) return liveTelemetry.get(deviceId) ?? null;

  return (
    [...liveTelemetry.values()].sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    )[0] ?? null
  );
}
