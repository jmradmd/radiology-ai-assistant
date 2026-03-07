import type { PrismaClient } from "@rad-assist/db";
import type { PHIOverrideSelection, PHIValidationResult } from "@rad-assist/shared";
import { prepareAuditData, getUnresolvedBlockingSpans } from "@rad-assist/shared";

export function isFullyOverridden(
  result: PHIValidationResult,
  overrides: PHIOverrideSelection[] | undefined
): boolean {
  return result.hasPHI && getUnresolvedBlockingSpans(result, overrides).length === 0;
}

export async function logPHIDetectionEvent(params: {
  prisma: PrismaClient;
  userId: string | null;
  endpoint: string;
  phiResult: PHIValidationResult;
  overrides?: PHIOverrideSelection[];
}) {
  const { prisma, userId, endpoint, phiResult, overrides } = params;
  const auditData = prepareAuditData(phiResult);
  const overridden = isFullyOverridden(phiResult, overrides);
  const detectionTypes = auditData.detectionTypes.length > 0 ? auditData.detectionTypes : ["UNKNOWN"];
  const spanIds = auditData.detectionSpanIds.join(",").slice(0, 255) || null;

  await prisma.pHIDetectionLog.createMany({
    data: detectionTypes.map((detectionType) => ({
      userId,
      inputHash: auditData.inputHash,
      detectionType,
      patternMatched: spanIds,
      confidence: 1.0,
      blocked: !overridden,
      clientSide: false,
      endpoint,
    })),
  });
}
