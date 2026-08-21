export type Limits = {
  pm25: number;
  pm10: number;
  gasPpm: number;
  minimumBattery: number;
  heartRateLow: number;
  heartRateHigh: number;
  spo2Low: number;
};
export type RiskInput = {
  pm25: number | null;
  pm10: number | null;
  gasPpm: number | null;
  batteryPct: number | null;
  heartRate: number | null;
  spo2: number | null;
  motion: string;
};
export function calculateRisk(r: RiskInput, t: Limits) {
  let score = 0;
  const reasons: string[] = [];
  if (r.pm25 !== null) {
    score += Math.min(35, (r.pm25 / t.pm25) * 22);
    if (r.pm25 > t.pm25) reasons.push("PM2.5 above limit");
  }
  if (r.pm10 !== null) {
    score += Math.min(20, (r.pm10 / t.pm10) * 12);
    if (r.pm10 > t.pm10) reasons.push("PM10 above limit");
  }
  if (r.gasPpm !== null) {
    score += Math.min(20, (r.gasPpm / t.gasPpm) * 12);
    if (r.gasPpm > t.gasPpm) reasons.push("Mixed-gas equivalent above limit");
  }
  if (r.batteryPct !== null && r.batteryPct < t.minimumBattery) {
    score += 8;
    reasons.push("Low battery");
  }
  if (
    r.heartRate !== null &&
    (r.heartRate < t.heartRateLow || r.heartRate > t.heartRateHigh)
  ) {
    score += 12;
    reasons.push("Heart rate outside range");
  }
  if (r.spo2 !== null && r.spo2 < t.spo2Low) {
    score += 18;
    reasons.push("Low SpO2");
  }
  if (r.motion === "anomaly") {
    score += 12;
    reasons.push("Motion anomaly");
  }
  if (r.motion === "fall") {
    score += 30;
    reasons.push("Fall detected");
  }
  return { score: Math.min(100, Math.round(score)), reasons };
}
