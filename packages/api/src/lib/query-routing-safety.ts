import type { EmergencyAssessment } from "./emergency-detection";
import type { QueryDomainRoute } from "./query-domain-classifier";

export function resolveEffectiveQueryRoute(
  classifierRoute: QueryDomainRoute,
  emergencyAssessment: Pick<EmergencyAssessment, "severity">
): QueryDomainRoute {
  const isUrgentOrEmergency =
    emergencyAssessment.severity === "urgent" || emergencyAssessment.severity === "emergency";

  if (classifierRoute === "KNOWLEDGE" && isUrgentOrEmergency) {
    return "HYBRID";
  }

  return classifierRoute;
}

export interface RetrievalDomainAvailability {
  protocolHitCount: number;
  knowledgeHitCount: number;
}

export interface KnowledgeCorpusAvailability {
  isIndexed: boolean;
  indexedDocumentCount: number;
}

export function reconcileRouteForKnowledgeAvailability(
  route: QueryDomainRoute,
  availability: KnowledgeCorpusAvailability
): { route: QueryDomainRoute; reason?: string; knowledgeUnavailableForRoute?: boolean } {
  if (availability.isIndexed) {
    return { route };
  }

  const indexedCount = Math.max(0, availability.indexedDocumentCount);

  if (route === "KNOWLEDGE") {
    return {
      route,
      reason: `Knowledge routing requested but Knowledge corpus is not indexed (${indexedCount} documents).`,
      knowledgeUnavailableForRoute: true,
    };
  }

  if (route === "HYBRID") {
    return {
      route: "PROTOCOL",
      reason: `Hybrid routing requested but Knowledge corpus is not indexed (${indexedCount} documents); continuing with protocol-only retrieval.`,
    };
  }

  return { route };
}

export function reconcileRouteAfterRetrieval(
  route: QueryDomainRoute,
  availability: RetrievalDomainAvailability
): { route: QueryDomainRoute; reason?: string } {
  const { protocolHitCount, knowledgeHitCount } = availability;

  if (route === "KNOWLEDGE" && knowledgeHitCount === 0 && protocolHitCount > 0) {
    return {
      route: "HYBRID",
      reason:
        "Knowledge-only routing returned no indexed knowledge hits; falling back to available protocol sources.",
    };
  }

  if (route === "PROTOCOL" && protocolHitCount === 0 && knowledgeHitCount > 0) {
    return {
      route: "HYBRID",
      reason:
        "Protocol-only routing returned no indexed protocol hits; falling back to available knowledge sources.",
    };
  }

  return { route };
}
