export const REJECTION_STAGES = [
  "DISCOVER",
  "SELECT-MONTAGE",
  "MONTAGE",
  "REVISION",
  "TEST",
] as const;

export type RejectionStage = (typeof REJECTION_STAGES)[number];

export type Rejection = {
  stage: RejectionStage;
  reason: string;
};

export type RejectionReasons = Map<string, Rejection>;

export function recordRejection(
  rejectionReasons: RejectionReasons,
  id: string,
  stage: RejectionStage,
  reason: string,
): void {
  rejectionReasons.set(id, { stage, reason });
}

export function formatRejectionSummary(
  rejectionReasons: RejectionReasons,
): string[] {
  return [...rejectionReasons].map(
    ([id, rejection]) =>
      `- ${id} [${rejection.stage}]: ${rejection.reason}`,
  );
}
