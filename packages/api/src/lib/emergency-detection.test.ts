import test from "node:test";
import assert from "node:assert/strict";
import { assessEmergency } from "./emergency-detection";

test("returns routine when no emergency indicators are present", () => {
  const assessment = assessEmergency("What is the MRI safety policy for routine outpatient screening?");

  assert.equal(assessment.severity, "routine");
  assert.equal(assessment.triggers.length, 0);
  assert.equal(assessment.numericAlerts.length, 0);
});

test("detects emergency for low oxygen saturation with hypotension context", () => {
  const assessment = assessEmergency(
    "What do I do if a patient has an oxygen saturation of 86 with hypotension, 90 over 60, after giving gadolinium?"
  );

  assert.equal(assessment.severity, "emergency");
  assert.equal(assessment.triggers.includes("hypotension"), true);
  assert.equal(assessment.numericAlerts.some((alert) => alert.includes("O2 sat 86%")), true);
});

test("detects critical BP pattern from slash format", () => {
  const assessment = assessEmergency("Patient is unresponsive with BP 82/40 after contrast.");

  assert.equal(assessment.severity, "emergency");
  assert.equal(assessment.numericAlerts.some((alert) => alert.includes("BP 82/40")), true);
});

test("does not treat 'gestational' as STAT emergency keyword", () => {
  const assessment = assessEmergency(
    "Patient has a positive beta-HCG but no gestational sac on ultrasound."
  );

  assert.equal(assessment.severity, "routine");
  assert.equal(assessment.triggers.includes("stat"), false);
});
