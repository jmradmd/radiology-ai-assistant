/**
 * Demo Data Seeder
 *
 * Creates sample radiology protocol documents for demonstration purposes.
 * All content is generic and based on publicly available clinical guidelines.
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts           # Seed demo data
 *   npx tsx scripts/seed-demo.ts --clean   # Remove all demo data
 *   npx tsx scripts/seed-demo.ts --dry-run # Preview without writing
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Dynamically import embedding generation to avoid top-level await issues
async function getEmbedding(text: string, task: 'query' | 'document' = 'query'): Promise<number[]> {
  const { generateEmbedding } = await import("../packages/api/src/lib/llm-client");
  return generateEmbedding(text, task);
}

interface SampleDocument {
  title: string;
  source: string;
  category: string;
  institution: "INSTITUTION_A" | "INSTITUTION_B" | "SHARED";
  chunks: string[];
}

const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    title: "Contrast Reaction Management Protocol",
    source: "Sample Protocol Collection",
    category: "CONTRAST",
    institution: "SHARED",
    chunks: [
      `CONTRAST REACTION MANAGEMENT PROTOCOL

Classification of Contrast Reactions:

MILD REACTIONS: Limited urticaria (scattered hives), mild pruritis, nasal congestion, sneezing, conjunctivitis, mild nausea. These are typically self-limiting and may not require treatment. Observe patient for 20-30 minutes.

MODERATE REACTIONS: Diffuse urticaria, facial edema without dyspnea, throat tightness without stridor, wheezing or mild bronchospasm, tachycardia or bradycardia. These require active treatment and close monitoring.

SEVERE REACTIONS: Diffuse edema or facial edema with dyspnea, diffuse erythema with hypotension, laryngeal edema with stridor or aphonia, hypotension (systolic BP < 90 mmHg), oxygen saturation < 92%, cardiopulmonary arrest. These are life-threatening and require immediate intervention.`,

      `TREATMENT ALGORITHM FOR SEVERE CONTRAST REACTIONS:

1. STOP the contrast injection immediately.
2. CALL for help (Code Blue if cardiac arrest, Rapid Response for other severe reactions).
3. MAINTAIN AIRWAY: Position patient supine with legs elevated (unless pulmonary edema suspected).
4. OXYGEN: Administer high-flow O2 via non-rebreather mask (10-15 L/min).
5. EPINEPHRINE:
   - Anaphylaxis with hypotension: Epinephrine 1:1,000 (1 mg/mL), 0.3 mL IM in anterolateral thigh. May repeat every 5-15 minutes.
   - Isolated bronchospasm: Consider inhaled beta-agonist (albuterol 2.5 mg nebulized) first.
6. IV ACCESS: Establish large-bore IV. Normal saline bolus 1-2 L for hypotension.
7. MONITORING: Continuous pulse oximetry, cardiac monitoring, blood pressure every 2-5 minutes.

Note: These are general guidelines based on ACR Manual on Contrast Media recommendations. Your institution may have specific modifications. Always follow your institutional protocol.`,

      `CONTRAST PREMEDICATION PROTOCOL:

For patients with prior moderate or severe contrast reaction:

ELECTIVE (13-hour preparation):
- Prednisone 50 mg PO at 13 hours, 7 hours, and 1 hour before contrast
- Diphenhydramine 50 mg PO/IV/IM 1 hour before contrast

ACCELERATED (5-hour preparation, for urgent cases):
- Methylprednisolone 40 mg IV OR Hydrocortisone 200 mg IV at 5 hours and 1 hour before contrast
- Diphenhydramine 50 mg IV 1 hour before contrast

EMERGENCY (when contrast cannot be delayed):
- Hydrocortisone 200 mg IV immediately
- Diphenhydramine 50 mg IV immediately
- Proceed with contrast administration with full resuscitation equipment at bedside
- Consider using a different contrast agent class than the one that caused the prior reaction

Note: Premedication reduces but does not eliminate the risk of repeat reaction. Breakthrough reactions can still occur.`,
    ],
  },
  {
    title: "MRI Safety Screening Protocol",
    source: "Sample Protocol Collection",
    category: "MRI_SAFETY",
    institution: "SHARED",
    chunks: [
      `MRI SAFETY SCREENING REQUIREMENTS:

All patients must be screened for MRI contraindications BEFORE entering Zone III (the MRI control room area) or Zone IV (the MRI scanner room).

ABSOLUTE CONTRAINDICATIONS:
- Non-MR-conditional cardiac pacemaker or defibrillator (ICD)
- Non-MR-conditional neurostimulator
- Metallic intraocular foreign body (unless confirmed removed by imaging)
- Certain types of aneurysm clips (particularly older ferromagnetic cerebral aneurysm clips)
- Swan-Ganz catheter
- Temporary transvenous pacing leads

CONDITIONAL CONTRAINDICATIONS (require specific evaluation):
- MR-conditional cardiac devices (require cardiology clearance, specific programming, monitoring)
- Cochlear implants (some newer models are MR-conditional under specific conditions)
- Programmable VP shunts (may need reprogramming after scan)
- Metallic heart valves (most modern valves are safe, but verify model)
- Joint replacements, spinal hardware (generally safe, but may cause artifact)`,

      `MRI ZONE DEFINITIONS AND ACCESS CONTROL:

Zone I: General public area (waiting room, reception). No restrictions.

Zone II: Interface between public and MRI environment. MRI screening takes place here. Patients change into MRI-safe gowns. All ferromagnetic objects must be removed.

Zone III: MRI control room. RESTRICTED ACCESS. Only screened individuals permitted. The technologist controls the scanner from this zone. The door between Zone III and Zone IV must remain closed when not actively moving patients.

Zone IV: The MRI scanner room. STRICTLY CONTROLLED. The static magnetic field is ALWAYS ON (even when the scanner appears idle). Only screened patients and personnel may enter. Every person must be screened every time they enter, regardless of prior clearance.

EMERGENCY PROCEDURES:
- MRI Zone IV emergency: Call MRI emergency code per institutional protocol
- DO NOT bring the crash cart into Zone IV unless it is MRI-conditional
- If patient is in distress and cannot be safely removed from the scanner, use MRI-conditional monitoring equipment only
- Quench procedure: Only as last resort for patient entrapment`,
    ],
  },
  {
    title: "Renal Function Assessment for Contrast Administration",
    source: "Sample Protocol Collection",
    category: "RENAL",
    institution: "SHARED",
    chunks: [
      `RENAL FUNCTION ASSESSMENT BEFORE IODINATED CONTRAST:

eGFR THRESHOLDS AND RISK STRATIFICATION:

- eGFR >= 30 mL/min/1.73m2: Standard IV iodinated contrast may be administered without specific renal precautions beyond standard hydration.
- eGFR < 30 mL/min/1.73m2 (not on dialysis): Increased risk of post-contrast acute kidney injury (PC-AKI). Consider alternatives: non-contrast CT, ultrasound, MRI. If contrast CT is essential, ensure IV hydration (normal saline 1 mL/kg/hr for 6-12 hours pre and post).
- eGFR < 15 mL/min/1.73m2 or on dialysis: Discuss with referring clinician and nephrology. Contrast can be given if clinically necessary, but benefits must outweigh risks.

TIMING OF eGFR:
- Stable outpatients: eGFR within 90 days is acceptable
- Inpatients or patients with acute illness: eGFR within 48 hours
- Emergency: Do not delay life-saving contrast-enhanced imaging to obtain eGFR

METFORMIN CONSIDERATIONS:
- eGFR >= 30: No need to discontinue metformin before or after contrast
- eGFR < 30: Hold metformin at time of contrast, reassess renal function 48 hours after, resume if stable
- Current ACR guidelines no longer recommend routine metformin discontinuation for patients with normal renal function`,
    ],
  },
  {
    title: "Critical Results Communication Policy",
    source: "Sample Protocol Collection",
    category: "CRITICAL",
    institution: "SHARED",
    chunks: [
      `CRITICAL RESULTS COMMUNICATION PROTOCOL:

DEFINITION: A critical result is an imaging finding that requires urgent clinical action to prevent serious patient harm, death, or significant morbidity.

EXAMPLES OF CRITICAL FINDINGS:
- Tension pneumothorax
- Acute aortic dissection or rupture
- Acute pulmonary embolism with right heart strain
- Acute intracranial hemorrhage
- Free intraperitoneal air (in non-postoperative patient)
- Ectopic pregnancy with evidence of rupture
- Malpositioned line or tube with potential for harm
- New or significantly worsening midline shift

COMMUNICATION REQUIREMENTS:
1. The interpreting radiologist must DIRECTLY communicate the critical finding to the responsible provider (attending physician, NP, or PA who can act on the result).
2. Communication must occur WITHIN 60 MINUTES of the radiologist identifying the finding.
3. If the responsible provider cannot be reached within 30 minutes, escalate through the chain of command.
4. DOCUMENT in the radiology report: the finding communicated, the person contacted, the method of communication, and the date/time.
5. Leaving a voicemail or sending a message through the EMR does NOT satisfy the direct communication requirement.`,
    ],
  },
  {
    title: "CT Protocol Selection Guide - Abdomen and Pelvis",
    source: "Sample Protocol Collection",
    category: "CT_PROTOCOL",
    institution: "INSTITUTION_B",
    chunks: [
      `CT ABDOMEN AND PELVIS PROTOCOL SELECTION:

ROUTINE ABDOMEN/PELVIS WITH IV CONTRAST:
- Indication: General abdominal pain, infection workup, staging
- Phases: Portal venous phase (70 seconds post-injection)
- Contrast: Iodinated IV contrast, weight-based dosing (typically 100-150 mL at 2-3 mL/s)
- Oral contrast: Per institutional preference. Not required for most indications.

CT ABDOMEN/PELVIS WITHOUT CONTRAST:
- Indication: Renal colic/urolithiasis, follow-up of known stones, claustrophobia with IV access issues
- No IV or oral contrast needed
- Dose reduction protocol for stone surveillance

TRIPLE-PHASE LIVER (MULTIPHASIC):
- Indication: Known or suspected HCC in at-risk patient (cirrhosis, chronic HBV), characterization of incidental liver lesion, LI-RADS assessment
- Phases: Late arterial (35s), portal venous (70s), delayed (180s)
- Contrast: High-rate injection (4-5 mL/s) with bolus tracking
- Note: Late arterial timing is critical for HCC detection. Early arterial timing will miss enhancing lesions.`,

      `CT ANGIOGRAPHY PROTOCOLS:

CTA CHEST (PULMONARY EMBOLISM):
- Indication: Suspected PE, D-dimer positive, Well's score intermediate-high
- Bolus tracking on main pulmonary artery (threshold 100 HU)
- Injection rate: 4-5 mL/s, 50-75 mL contrast
- Scan direction: Caudocranial (reduces respiratory motion artifact at lung bases)

CTA AORTA (DISSECTION/ANEURYSM):
- Indication: Acute chest pain, known aneurysm surveillance, post-repair follow-up
- ECG-gated if ascending aorta evaluation needed
- Arterial phase with optional delayed phase (to detect endoleak in post-graft patients)
- Coverage: Thoracic inlet to femoral heads

CTA ABDOMEN (MESENTERIC ISCHEMIA):
- Indication: Acute abdominal pain out of proportion to exam, suspected mesenteric ischemia
- Arterial and portal venous phases
- Thin slice reconstruction (0.625-1.0 mm) for 3D reformats`,
    ],
  },
];

async function seedDemo() {
  console.log("Seeding demo documents...\n");

  for (const doc of SAMPLE_DOCUMENTS) {
    console.log(`  Creating: ${doc.title} (${doc.category})`);

    // Create the document
    const document = await prisma.document.create({
      data: {
        title: doc.title,
        source: doc.source,
        category: doc.category,
        institution: doc.institution,
        content: doc.chunks.join("\n\n---\n\n"),
        metadata: { demo: true, seededAt: new Date().toISOString() },
        isActive: true,
      },
    });

    // Create chunks with embeddings
    for (let i = 0; i < doc.chunks.length; i++) {
      const chunkContent = doc.chunks[i];
      console.log(`    Chunk ${i + 1}/${doc.chunks.length}: generating embedding...`);

      const embedding = await getEmbedding(chunkContent, 'document');

      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" ("id", "documentId", "chunkIndex", "content", "embedding", "institution")
        VALUES (
          gen_random_uuid(),
          ${document.id},
          ${i},
          ${chunkContent},
          ${`[${embedding.join(',')}]`}::vector,
          ${doc.institution}::"Institution"
        )
      `;
    }

    console.log(`    Done: ${doc.chunks.length} chunks embedded.\n`);
  }

  console.log("Demo seeding complete.");
  console.log(`Created ${SAMPLE_DOCUMENTS.length} documents with ${SAMPLE_DOCUMENTS.reduce((sum, d) => sum + d.chunks.length, 0)} chunks.`);
  console.log('\nTo remove demo data later: npx tsx scripts/seed-demo.ts --clean');
}

async function cleanDemo() {
  console.log("Removing demo documents...");

  // Find all demo documents
  const demoDocuments = await prisma.document.findMany({
    where: {
      metadata: {
        path: ["demo"],
        equals: true,
      },
    },
    select: { id: true, title: true },
  });

  if (demoDocuments.length === 0) {
    console.log("No demo documents found.");
    return;
  }

  console.log(`Found ${demoDocuments.length} demo documents:`);
  for (const doc of demoDocuments) {
    console.log(`  - ${doc.title}`);
  }

  // Delete chunks first (foreign key)
  const chunkResult = await prisma.documentChunk.deleteMany({
    where: {
      documentId: { in: demoDocuments.map((d) => d.id) },
    },
  });
  console.log(`Deleted ${chunkResult.count} chunks.`);

  // Delete documents
  const docResult = await prisma.document.deleteMany({
    where: {
      id: { in: demoDocuments.map((d) => d.id) },
    },
  });
  console.log(`Deleted ${docResult.count} documents.`);
  console.log("Demo data cleanup complete.");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--clean")) {
    await cleanDemo();
  } else if (args.includes("--dry-run")) {
    console.log("DRY RUN: Would create the following documents:\n");
    for (const doc of SAMPLE_DOCUMENTS) {
      console.log(`  ${doc.title} (${doc.category}, ${doc.institution})`);
      console.log(`    ${doc.chunks.length} chunks, ~${doc.chunks.reduce((s, c) => s + c.length, 0)} chars\n`);
    }
    console.log(`Total: ${SAMPLE_DOCUMENTS.length} documents, ${SAMPLE_DOCUMENTS.reduce((s, d) => s + d.chunks.length, 0)} chunks`);
  } else {
    await seedDemo();
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  prisma.$disconnect();
  process.exit(1);
});
