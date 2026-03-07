import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileRouteAfterRetrieval,
  reconcileRouteForKnowledgeAvailability,
  resolveEffectiveQueryRoute,
} from "./query-routing-safety";

test("upgrades KNOWLEDGE route to HYBRID for urgent/emergency severity", () => {
  assert.equal(resolveEffectiveQueryRoute("KNOWLEDGE", { severity: "urgent" }), "HYBRID");
  assert.equal(resolveEffectiveQueryRoute("KNOWLEDGE", { severity: "emergency" }), "HYBRID");
});

test("keeps non-KNOWLEDGE routes unchanged", () => {
  assert.equal(resolveEffectiveQueryRoute("PROTOCOL", { severity: "emergency" }), "PROTOCOL");
  assert.equal(resolveEffectiveQueryRoute("HYBRID", { severity: "urgent" }), "HYBRID");
  assert.equal(resolveEffectiveQueryRoute("KNOWLEDGE", { severity: "routine" }), "KNOWLEDGE");
});

test("does not upgrade PROTOCOL or HYBRID for routine severity", () => {
  assert.equal(resolveEffectiveQueryRoute("PROTOCOL", { severity: "routine" }), "PROTOCOL");
  assert.equal(resolveEffectiveQueryRoute("HYBRID", { severity: "routine" }), "HYBRID");
});

test("falls back from KNOWLEDGE to HYBRID when only protocol has hits", () => {
  const reconciled = reconcileRouteAfterRetrieval("KNOWLEDGE", {
    protocolHitCount: 4,
    knowledgeHitCount: 0,
  });

  assert.equal(reconciled.route, "HYBRID");
  assert.match(reconciled.reason ?? "", /Knowledge-only routing returned no indexed knowledge hits/i);
});

test("falls back from PROTOCOL to HYBRID when only knowledge has hits", () => {
  const reconciled = reconcileRouteAfterRetrieval("PROTOCOL", {
    protocolHitCount: 0,
    knowledgeHitCount: 3,
  });

  assert.equal(reconciled.route, "HYBRID");
  assert.match(reconciled.reason ?? "", /Protocol-only routing returned no indexed protocol hits/i);
});

test("keeps route unchanged when requested domain has hits", () => {
  assert.equal(
    reconcileRouteAfterRetrieval("KNOWLEDGE", {
      protocolHitCount: 2,
      knowledgeHitCount: 1,
    }).route,
    "KNOWLEDGE"
  );

  assert.equal(
    reconcileRouteAfterRetrieval("PROTOCOL", {
      protocolHitCount: 1,
      knowledgeHitCount: 5,
    }).route,
    "PROTOCOL"
  );

  assert.equal(
    reconcileRouteAfterRetrieval("HYBRID", {
      protocolHitCount: 0,
      knowledgeHitCount: 0,
    }).route,
    "HYBRID"
  );
});

test("flags KNOWLEDGE route when Knowledge corpus is not indexed", () => {
  const reconciled = reconcileRouteForKnowledgeAvailability("KNOWLEDGE", {
    isIndexed: false,
    indexedDocumentCount: 0,
  });

  assert.equal(reconciled.route, "KNOWLEDGE");
  assert.equal(reconciled.knowledgeUnavailableForRoute, true);
  assert.match(reconciled.reason ?? "", /Knowledge corpus is not indexed/i);
});

test("downgrades HYBRID route to PROTOCOL when Knowledge corpus is not indexed", () => {
  const reconciled = reconcileRouteForKnowledgeAvailability("HYBRID", {
    isIndexed: false,
    indexedDocumentCount: 0,
  });

  assert.equal(reconciled.route, "PROTOCOL");
  assert.equal(reconciled.knowledgeUnavailableForRoute, undefined);
  assert.match(reconciled.reason ?? "", /continuing with protocol-only retrieval/i);
});
