export type EstimateBreakdown = {
  base: number;
  queue: number;
  correction: number;
  history_used: boolean;
  inputs: Record<string, unknown>;
};

export function estimateBreakdownText(
  minutes: number,
  breakdown: EstimateBreakdown | null,
): string | null {
  if (!breakdown) return null;
  const base = Math.round(breakdown.base);
  const queue = Math.round(breakdown.queue);
  const correction = Math.round(breakdown.correction);
  const parts = [base, queue, correction];
  const labels = ["prep", "queue", "history"];
  const difference = minutes - parts.reduce((sum, part) => sum + part, 0);
  if (difference) {
    const largestIndex = parts.reduce(
      (best, part, index) =>
        part > parts[best] || (part === parts[best] && index < best) ? index : best,
      0,
    );
    parts[largestIndex] += difference;
  }
  return `Estimate ${minutes} min: ${parts.map((part, i) => `${part} ${labels[i]}`).join(" + ")}`;
}
