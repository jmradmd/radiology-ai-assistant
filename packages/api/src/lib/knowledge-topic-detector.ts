/**
 * Knowledge Mode Topic Detector
 *
 * Lightweight keyword -> Knowledge category mapping for retrieval category boosting.
 * Knowledge categories differ from Protocol categories (anatomical vs procedural).
 *
 * This runs INSTEAD of the Protocol topic detector when domain === "KNOWLEDGE".
 */

interface KnowledgeCategoryMapping {
  category: string;
  keywords: string[];
  patterns: RegExp[];
}

const KNOWLEDGE_CATEGORIES: KnowledgeCategoryMapping[] = [
  {
    category: 'NEURORADIOLOGY',
    keywords: [
      'brain', 'cerebral', 'intracranial', 'stroke', 'cva', 'ischemic',
      'hemorrhage', 'subarachnoid', 'meningioma', 'glioma', 'glioblastoma',
      'white matter', 'demyelinating', 'ms ', 'multiple sclerosis',
      'hydrocephalus', 'ventricle', 'pituitary', 'sella', 'cranial nerve',
      'temporal lobe', 'frontal lobe', 'occipital', 'parietal',
      'basal ganglia', 'thalamus', 'cerebellum', 'brainstem',
    ],
    patterns: [
      /\b(brain|cerebr|intracranial|neuroradi)/i,
      /\b(stroke|cva|isch[ae]mic)\b/i,
      /\b(gliom|meningiom|astrocytom|oligodendrogliom)/i,
    ],
  },
  {
    category: 'SPINE',
    keywords: [
      'spine', 'spinal', 'vertebr', 'disc', 'disk', 'herniation',
      'stenosis', 'cord', 'myelopathy', 'radiculopathy', 'spondyl',
      'cervical spine', 'thoracic spine', 'lumbar spine', 'sacrum',
      'cauda equina', 'epidural', 'foramen', 'facet',
    ],
    patterns: [
      /\b(spin[ae]l|vertebr|myelopath|radiculopath)/i,
      /\b(cervical|thoracic|lumbar)\s*(spine|stenosis|disc)/i,
      /\bspondyl/i,
    ],
  },
  {
    category: 'HEAD_AND_NECK',
    keywords: [
      'head and neck', 'parotid', 'thyroid', 'parathyroid', 'larynx',
      'pharynx', 'nasopharynx', 'oropharynx', 'hypopharynx', 'sinus',
      'orbit', 'temporal bone', 'mastoid', 'salivary', 'neck mass',
      'lymph node neck', 'deep neck space', 'infrahyoid', 'suprahyoid',
    ],
    patterns: [
      /\bhead\s*(and|&)\s*neck/i,
      /\b(parotid|thyroid|parathyroid|salivary)/i,
      /\b(naso|oro|hypo)pharyn/i,
      /\b(laryn[gx]|pharyn[gx])/i,
    ],
  },
  {
    category: 'CHEST_THORACIC',
    keywords: [
      'lung', 'pulmonary', 'chest', 'thorax', 'thoracic', 'pleural',
      'mediastin', 'pneumonia', 'pneumothorax', 'nodule', 'mass',
      'bronch', 'emphysema', 'copd', 'fibrosis', 'interstitial',
      'ground glass', 'fleischner', 'lung-rads', 'pet-avid', 'spiculated',
      'consolidation', 'atelectasis', 'hilar', 'trachea',
    ],
    patterns: [
      /\b(lung|pulmonar|thoraci|pleural)/i,
      /\b(pneumo(nia|thorax)|mediastin)/i,
      /\b(fleischner|lung[\s-]?rads)/i,
      /\binterstitial\s*lung/i,
    ],
  },
  {
    category: 'CARDIAC_VASCULAR',
    keywords: [
      'cardiac', 'heart', 'aorta', 'aortic', 'coronary', 'pericardi',
      'cardiomyopathy', 'valvular', 'aneurysm', 'dissection',
      'pulmonary embolism', 'dvt', 'venous', 'arterial', 'vascular',
      'carotid', 'mesenteric', 'renal artery', 'iliac', 'aortitis',
    ],
    patterns: [
      /\b(cardiac|coronary|aortic|pericardi)/i,
      /\bpulmonary\s*embol/i,
      /\b(aneurysm|dissection)\b/i,
      /\b(carotid|mesenteric|iliac)\s*(arter|stenosis|occlusion)/i,
    ],
  },
  {
    category: 'ABDOMEN_GI',
    keywords: [
      'liver', 'hepat', 'hepatocellular', 'hcc', 'li-rads', 'lirads',
      'pancrea', 'spleen', 'gallbladder', 'bile', 'biliary', 'bowel',
      'colon', 'appendix', 'appendicitis', 'small bowel', 'duodenum',
      'stomach', 'gastric', 'esophag', 'peritoneum', 'peritoneal',
      'mesentery', 'omentum', 'retroperitoneal', 'ascites',
      'fibrolamellar', 'cholangiocarcinoma', 'cirrhosis',
    ],
    patterns: [
      /\b(hepat|liver|hcc|li[\s-]?rads)/i,
      /\b(pancrea|spleen|gallbladder|biliar)/i,
      /\b(bowel|colon|appendic|peritonea)/i,
      /\b(fibrolamellar|cholangiocarcinoma|cirrhosis)/i,
    ],
  },
  {
    category: 'RENAL',
    keywords: [
      'kidney', 'renal', 'adrenal', 'ureter', 'bladder', 'urinary',
      'renal cell', 'rcc', 'oncocytoma', 'angiomyolipoma', 'bosniak',
      'cyst', 'hydronephrosis', 'nephrectomy', 'urothelial',
      'collecting system', 'pyelonephritis', 'renal mass',
      'genitourinary', 'retroperitoneal',
    ],
    patterns: [
      /\b(kidney|renal|adrenal|ureter|bladder)/i,
      /\brenal\s*(cell|mass|cyst|carcinoma|staging)/i,
      /\b(bosniak|rcc|oncocytoma|angiomyolipoma)/i,
      /\burothelial/i,
    ],
  },
  {
    category: 'GYNECOLOGIC_OBSTETRIC',
    keywords: [
      'ovary', 'ovarian', 'uterus', 'uterine', 'cervix', 'cervical cancer',
      'endometri', 'fibroid', 'adnexal', 'o-rads', 'pregnancy',
      'placenta', 'fetal', 'ectopic', 'molar', 'gestational',
    ],
    patterns: [
      /\b(ovar[iy]|uterin|cervic|endometri)/i,
      /\bo[\s-]?rads/i,
      /\b(adnexal|fibroid|placent)/i,
    ],
  },
  {
    category: 'MUSCULOSKELETAL',
    keywords: [
      'bone', 'joint', 'fracture', 'tendon', 'ligament', 'muscle',
      'meniscus', 'rotator cuff', 'acl', 'mcl', 'cartilage',
      'osteoarthritis', 'osteomyelitis', 'sarcoma', 'osteosarcoma',
      'avascular necrosis', 'avn', 'stress fracture', 'labrum',
      'shoulder', 'knee', 'hip', 'ankle', 'wrist', 'elbow',
    ],
    patterns: [
      /\b(fractur|tendon|ligament|menisc)/i,
      /\b(rotator\s*cuff|labr[au]m)/i,
      /\b(osteo(myelitis|sarcoma|arthritis))/i,
    ],
  },
  {
    category: 'MAMMO',
    keywords: [
      'breast', 'mammogra', 'birads', 'bi-rads', 'tomosynthesis',
      'breast mass', 'breast calcification', 'dcis', 'breast mri',
      'axillary', 'breast ultrasound', 'breast biopsy',
    ],
    patterns: [
      /\bbreast\s*(mass|calcif|lesion|mri|imaging)/i,
      /\bbi[\s-]?rads/i,
      /\bmammogra/i,
    ],
  },
  {
    category: 'PEDIATRIC',
    keywords: [
      'pediatric', 'child', 'neonatal', 'infant', 'congenital',
      'developmental', 'wilms', 'neuroblastoma', 'retinoblastoma',
    ],
    patterns: [
      /\b(pediatric|paediatric|neonat|congenital)/i,
      /\b(wilms|neuroblastoma)/i,
    ],
  },
  {
    category: 'NUCLEAR_MEDICINE',
    keywords: [
      'pet', 'spect', 'scintigraphy', 'bone scan', 'fdg', 'suv',
      'radiotracer', 'radionuclide', 'thyroid scan', 'octreotide',
      'mibg', 'gallium', 'nuclear medicine',
    ],
    patterns: [
      /\b(pet[\s\/]ct|spect[\s\/]ct|scintigraph)/i,
      /\b(fdg|suv|radiotracer)/i,
    ],
  },
];

// Common stop words in radiology queries
const STOP_WORDS = new Set([
  'what', 'how', 'when', 'where', 'which', 'does', 'the', 'and', 'for',
  'with', 'from', 'that', 'this', 'are', 'was', 'can', 'about', 'have',
  'imaging', 'findings', 'features', 'diagnosis', 'differential', 'protocol',
  'recommend', 'management', 'treatment', 'approach', 'describe', 'explain',
  'patient', 'study', 'report', 'radiology',
]);

export interface KnowledgeTopicResult {
  category: string;
  confidence: number;
  matchedTerms: string[];
}

/**
 * Detect knowledge-relevant topic categories from a query.
 * Returns sorted list of candidate categories for boosting.
 */
export function detectKnowledgeTopics(query: string): KnowledgeTopicResult[] {
  const queryLower = query.toLowerCase();
  const results: KnowledgeTopicResult[] = [];

  for (const cat of KNOWLEDGE_CATEGORIES) {
    let confidence = 0;
    const matchedTerms: string[] = [];

    // Keyword matches
    for (const kw of cat.keywords) {
      if (queryLower.includes(kw.toLowerCase())) {
        matchedTerms.push(kw);
        confidence += 0.25 + (kw.length / 60);
      }
    }

    // Regex pattern matches (stronger signal)
    for (const pattern of cat.patterns) {
      const match = queryLower.match(pattern);
      if (match) {
        if (!matchedTerms.includes(match[0])) matchedTerms.push(match[0]);
        confidence += 0.35;
      }
    }

    if (confidence > 0) {
      results.push({
        category: cat.category,
        confidence: Math.min(1.0, confidence),
        matchedTerms,
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get the best knowledge category for boosting, or null if none detected.
 */
export function getKnowledgeBoostCategory(query: string): { category: string; confidence: number } | null {
  const topics = detectKnowledgeTopics(query);
  if (topics.length === 0) return null;
  // Only boost if confidence is meaningful
  if (topics[0].confidence < 0.3) return null;
  return { category: topics[0].category, confidence: topics[0].confidence };
}
