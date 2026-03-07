/**
 * Topic Detection for RAG Query Routing
 * 
 * Detects likely topics from user queries and suggests clarifications
 * when ambiguous. Similar pattern to abbreviation-detector.ts but for
 * semantic topic routing.
 */

export interface TopicDefinition {
  id: string;
  label: string;
  category: string; // Maps to document category for boosting
  keywords: string[]; // Exact or partial matches
  patterns: RegExp[]; // Regex patterns for more complex matching
  priority: number; // Higher = more specific, wins ties
}

export interface DetectedTopic {
  topic: TopicDefinition;
  confidence: number; // 0-1, based on match quality
  matchedTerms: string[]; // What triggered the match
}

export interface TopicAnalysis {
  detectedTopics: DetectedTopic[];
  primaryTopic: DetectedTopic | null;
  needsClarification: boolean;
  suggestedTopics: Array<{ id: string; label: string; category: string; confidence: number }>;
}

/**
 * Topic definitions with keywords and patterns
 * Organized by specificity - more specific topics have higher priority
 */
export const TOPIC_DEFINITIONS: TopicDefinition[] = [
  // === CONTRAST - High specificity subtopics ===
  {
    id: 'contrast-reaction',
    label: 'Contrast Reactions',
    category: 'CONTRAST',
    keywords: [
      'contrast reaction', 'allergic reaction', 'anaphylaxis', 'anaphylactic',
      'contrast allergy', 'iodine allergy', 'hives', 'urticaria', 'bronchospasm',
      'laryngeal edema', 'hypotension reaction', 'contrast emergency', 'angioedema'
    ],
    patterns: [
      // Direct mentions
      /contrast\s*(adverse|allergic|anaphyla)/i,
      /react(ion|ed|ing)\s*(to\s*)?contrast/i,
      /allerg(y|ic)\s*(to\s*)?(contrast|iodine|dye)/i,
    ],
    priority: 10,
    // Custom detection handled in detectTopics() for symptom+contrast combo
  },
  {
    id: 'contrast-premedication',
    label: 'Contrast Premedication',
    category: 'CONTRAST',
    keywords: [
      'premedication', 'premed', 'premedicate', 'steroid', 'benadryl',
      'diphenhydramine', 'prednisone', 'methylprednisolone', 'solu-medrol',
      'prophylaxis', 'pretreatment', 'prior reaction'
    ],
    patterns: [
      /pre\s*med(ication|icate)?/i,
      /steroid\s*(protocol|regimen|prep)/i,
      /prophyla(xis|ctic)\s*(for\s*)?contrast/i,
      /(history|prior|previous)\s*(of\s*)?(contrast\s*)?reaction/i,
    ],
    priority: 10,
  },
  {
    id: 'contrast-extravasation',
    label: 'Contrast Extravasation',
    category: 'CONTRAST',
    keywords: [
      'extravasation', 'infiltration', 'contrast leak', 'iv infiltrate',
      'swelling', 'compartment syndrome'
    ],
    patterns: [
      /extravasa(tion|ted|te)/i,
      /contrast\s*(leak|infiltrat)/i,
      /iv\s*(site\s*)?(swell|infiltrat)/i,
    ],
    priority: 10,
  },
  {
    id: 'contrast-general',
    label: 'Contrast Protocols',
    category: 'CONTRAST',
    keywords: [
      'contrast', 'iodine', 'gadolinium', 'omnipaque', 'isovue', 'visipaque',
      'contrast dose', 'contrast volume', 'contrast rate'
    ],
    patterns: [
      /contrast\s*(agent|medium|material|dye)/i,
      /iodinated\s*contrast/i,
    ],
    priority: 5,
  },

  // === RENAL ===
  {
    id: 'renal-egfr',
    label: 'eGFR & Contrast',
    category: 'RENAL',
    keywords: [
      'egfr', 'gfr', 'creatinine', 'kidney function', 'renal function',
      'ckd', 'chronic kidney', 'aki', 'acute kidney', 'nephropathy',
      'contrast nephropathy', 'cin', 'contrast-induced'
    ],
    patterns: [
      /e?gfr\s*(threshold|cutoff|level|value|check)/i,
      /creatinine\s*(level|check|clear)/i,
      /(kidney|renal)\s*(function|insufficiency|failure)/i,
      /contrast[\s-]*(induced\s*)?nephropathy/i,
    ],
    priority: 8,
  },
  {
    id: 'renal-dialysis',
    label: 'Dialysis & Contrast',
    category: 'RENAL',
    keywords: [
      'dialysis', 'hemodialysis', 'peritoneal dialysis', 'esrd',
      'end stage renal', 'contrast dialysis'
    ],
    patterns: [
      /dialysis\s*(patient|after|before|timing)/i,
      /contrast\s*(and|in|for)\s*dialysis/i,
    ],
    priority: 8,
  },

  // === MRI SAFETY ===
  {
    id: 'mri-implants',
    label: 'MRI & Implants',
    category: 'MRI_SAFETY',
    keywords: [
      'pacemaker', 'icd', 'defibrillator', 'implant', 'mri safe',
      'mri conditional', 'mri compatible', 'cochlear', 'neurostimulator',
      'spinal cord stimulator', 'stent', 'aneurysm clip', 'shunt'
    ],
    patterns: [
      /pacemaker\s*(mri|scan|safe)/i,
      /mri\s*(with|and)\s*(pacemaker|icd|implant)/i,
      /(implant|device)\s*(mri|safe|conditional)/i,
      /can\s*(patient|they|i)\s*(have|get)\s*mri/i,
    ],
    priority: 9,
  },
  {
    id: 'mri-screening',
    label: 'MRI Screening',
    category: 'MRI_SAFETY',
    keywords: [
      'mri screening', 'metal screening', 'zone', 'zone 4', 'zone 3',
      'ferromagnetic', 'projectile', 'quench'
    ],
    patterns: [
      /mri\s*(screening|questionnaire|checklist)/i,
      /zone\s*[34]/i,
      /ferromagnetic\s*(screening|detection|object)/i,
    ],
    priority: 8,
  },
  {
    id: 'mri-gadolinium',
    label: 'Gadolinium Safety',
    category: 'MRI_SAFETY',
    keywords: [
      'gadolinium', 'gad', 'nsf', 'nephrogenic systemic fibrosis',
      'gadavist', 'dotarem', 'eovist', 'primovist', 'multihance'
    ],
    patterns: [
      /gadolinium\s*(dose|safe|reaction|allergy)/i,
      /gad\s*(contrast|agent)/i,
      /nsf\s*(risk|screening)/i,
    ],
    priority: 9,
  },

  // === CT PROTOCOL ===
  {
    id: 'ct-cardiac',
    label: 'Cardiac CT',
    category: 'CT_PROTOCOL',
    keywords: [
      'cta', 'coronary cta', 'ccta', 'calcium score', 'cardiac ct',
      'triple rule out', 'ct angiography', 'heart rate', 'beta blocker'
    ],
    patterns: [
      /c(oronary\s*)?cta/i,
      /cardiac\s*(ct|cta)/i,
      /ct\s*(coronary|angiograph)/i,
      /calcium\s*scor/i,
    ],
    priority: 8,
  },
  {
    id: 'ct-pe',
    label: 'CT for PE',
    category: 'CT_PROTOCOL',
    keywords: [
      'cta pe', 'pe protocol', 'pulmonary embolism', 'ctpa',
      'pe study', 'd-dimer'
    ],
    patterns: [
      /ct(a)?\s*(for\s*)?p(ulmonary\s*)?e(mbolism)?/i,
      /pe\s*(protocol|study|ct)/i,
    ],
    priority: 8,
  },
  {
    id: 'ct-stroke',
    label: 'Stroke Imaging Protocol',
    category: 'CT_PROTOCOL',
    keywords: [
      'stroke', 'cva', 'cta head', 'cta neck', 'cta h&n', 'cta head and neck',
      'stroke protocol', 'stroke code', 'stroke eval', 'tia', 'ischemic stroke',
      'hemorrhagic stroke', 'ct perfusion', 'ctp', 'large vessel occlusion', 'lvo'
    ],
    patterns: [
      /stroke\s*(protocol|code|eval|imaging|ct|cta)/i,
      /cta\s*(head|neck|h\s*&?\s*n|brain)/i,
      /ct\s*(for\s*)?stroke/i,
      /(cva|tia)\s*(eval|protocol|imaging|workup)/i,
    ],
    priority: 9, // High priority - stroke is time-sensitive
  },
  {
    id: 'ct-general',
    label: 'CT Protocols',
    category: 'CT_PROTOCOL',
    keywords: [
      'ct protocol', 'ct scan', 'computed tomography', 'ct with contrast',
      'ct without contrast', 'ct abdomen', 'ct chest', 'ct head'
    ],
    patterns: [
      /ct\s*(protocol|scan|study)/i,
    ],
    priority: 5,
  },

  // === PEDIATRIC ===
  {
    id: 'pediatric',
    label: 'Pediatric Protocols',
    category: 'PEDIATRIC',
    keywords: [
      'pediatric', 'peds', 'child', 'children', 'infant', 'neonate',
      'newborn', 'kid', 'baby', 'adolescent', 'weight-based', 'pediatric dose'
    ],
    patterns: [
      /pediatric\s*(dose|protocol|patient|ct|mri)/i,
      /child(ren)?\s*(dose|protocol|scan)/i,
      /(dose|protocol)\s*(for\s*)?(child|peds|pediatric)/i,
      /weight[\s-]based\s*(dos|contrast)/i,
    ],
    priority: 7,
  },

  // === PREGNANCY ===
  {
    id: 'pregnancy',
    label: 'Imaging in Pregnancy',
    category: 'PREGNANCY',
    keywords: [
      'pregnant', 'pregnancy', 'gravid', 'fetal', 'fetus', 'trimester',
      'breastfeeding', 'lactation', 'nursing mother'
    ],
    patterns: [
      /pregnan(t|cy)\s*(patient|scan|imaging|ct|mri)/i,
      /(imaging|contrast|ct|mri)\s*(in|during)\s*pregnan/i,
      /breast\s*feed(ing)?\s*(contrast|safe)/i,
    ],
    priority: 9,
  },

  // === NURSING/IV ===
  {
    id: 'nursing-iv',
    label: 'IV Access & Nursing',
    category: 'NURSING',
    keywords: [
      'iv access', 'iv site', 'port', 'picc', 'central line', 'power inject',
      'power injectable', 'iv gauge', 'butterfly', 'infiltration'
    ],
    patterns: [
      /iv\s*(access|site|gauge|start)/i,
      /power\s*inject(able|ion)?/i,
      /(picc|port|central\s*line)\s*(inject|use|safe)/i,
    ],
    priority: 6,
  },

  // === MAMMOGRAPHY ===
  {
    id: 'mammography',
    label: 'Mammography',
    category: 'MAMMO',
    keywords: [
      'mammogram', 'mammography', 'breast', 'birads', 'bi-rads',
      'screening mammogram', 'diagnostic mammogram', 'tomosynthesis',
      'breast biopsy', 'breast mri'
    ],
    patterns: [
      /mammo(gram|graphy)?/i,
      /breast\s*(imaging|screen|biopsy|mri)/i,
      /bi[\s-]?rads/i,
    ],
    priority: 7,
  },

  // === SAFETY ===
  {
    id: 'radiation-safety',
    label: 'Radiation Safety',
    category: 'SAFETY',
    keywords: [
      'radiation', 'dose', 'exposure', 'alara', 'lead', 'thyroid shield',
      'badge', 'dosimeter', 'radiation protection'
    ],
    patterns: [
      /radiation\s*(dose|safety|protection|exposure)/i,
      /alara/i,
      /(lead|thyroid)\s*(shield|apron|protection)/i,
    ],
    priority: 6,
  },

  // === CRITICAL/EMERGENCY ===
  {
    id: 'critical-findings',
    label: 'Critical Results',
    category: 'CRITICAL',
    keywords: [
      'critical finding', 'critical result', 'critical value',
      'stat read', 'emergent finding', 'urgent communication'
    ],
    patterns: [
      /critical\s*(finding|result|value)/i,
      /stat\s*(read|finding|result)/i,
      /emergent\s*(finding|communication)/i,
    ],
    priority: 9,
  },
  // === ULTRASOUND ===
  {
    id: 'ultrasound',
    label: 'Ultrasound',
    category: 'ULTRASOUND',
    keywords: [
      'ultrasound', 'sonography', 'sonogram', 'doppler', 'duplex',
      'transducer', 'probe', 'us-guided'
    ],
    patterns: [
      /ultrasound\s*(protocol|study|guided|exam)/i,
      /doppler\s*(study|ultrasound|flow|exam)/i,
      /us[\s-]?guided\s*(procedure|biopsy|drain|aspiration)/i,
    ],
    priority: 6,
  },

  // === NUCLEAR MEDICINE ===
  {
    id: 'nuclear-medicine',
    label: 'Nuclear Medicine',
    category: 'SAFETY',
    keywords: [
      'nuclear medicine', 'pet', 'pet-ct', 'bone scan', 'scintigraphy',
      'thyroid scan', 'mibg', 'gallium', 'fdg', 'radiotracer', 'suv'
    ],
    patterns: [
      /nuclear\s*medicine\s*(protocol|study|scan)?/i,
      /pet[\s-]?ct\s*(protocol|scan|study)?/i,
      /bone\s*scan\s*(protocol|indication|finding)?/i,
    ],
    priority: 7,
  },

  // === ABDOMINAL IMAGING ===
  {
    id: 'abdominal-imaging',
    label: 'Abdominal Imaging',
    category: 'GENERAL',
    keywords: [
      'abdominal', 'liver', 'hepatic', 'pancreas', 'pancreatic', 'spleen',
      'kidney', 'renal mass', 'bowel', 'colon', 'appendix', 'appendicitis',
      'gallbladder', 'biliary'
    ],
    patterns: [
      /abdominal\s*(ct|mri|ultrasound|imaging|protocol)/i,
      /liver\s*(lesion|mass|imaging|protocol|mri)/i,
      /(appendicitis|appendix)\s*(protocol|imaging|ct|ultrasound)?/i,
      /gallbladder\s*(ultrasound|imaging|protocol)?/i,
    ],
    priority: 6,
  },

  // === MSK IMAGING ===
  {
    id: 'msk-imaging',
    label: 'MSK Imaging',
    category: 'GENERAL',
    keywords: [
      'musculoskeletal', 'msk', 'fracture', 'bone', 'joint', 'arthritis',
      'tendon', 'ligament', 'meniscus', 'rotator cuff', 'spine', 'vertebral'
    ],
    patterns: [
      /musculoskeletal\s*(imaging|protocol|mri|ct|ultrasound)/i,
      /msk\s*(mri|ct|ultrasound|imaging|protocol)/i,
      /fracture\s*(protocol|imaging|detection|ct|mri)?/i,
      /rotator\s*cuff\s*(tear|imaging|mri|protocol)?/i,
    ],
    priority: 6,
  },

  // === IR PROCEDURES ===
  {
    id: 'ir-procedures',
    label: 'IR Procedures',
    category: 'GENERAL',
    keywords: [
      'interventional', 'ir', 'biopsy', 'drain', 'drainage', 'embolization',
      'embolize', 'stent', 'ablation', 'tips', 'angiography', 'angioplasty',
      'catheter'
    ],
    patterns: [
      /interventional\s*(radiology|procedure|protocol)/i,
      /ir\s*(procedure|protocol|consult|biopsy)/i,
      /(embolization|embolize)\s*(protocol|procedure)?/i,
      /(biopsy|drain(age)?)\s*(protocol|procedure|placement)?/i,
    ],
    priority: 7,
  },

  // === IT SYSTEMS TROUBLESHOOTING ===
  {
    id: 'it-pacs',
    label: 'PACS',
    category: 'GENERAL',
    keywords: [
      'pacs', 'vuepacs', 'vue pacs', 'carestream', 'hanging protocol',
      'prior retrieval', 'image display', 'viewer', 'multi-monitor',
      'display layout', 'black screen', 'monitor setup'
    ],
    patterns: [
      /(vue\s*)?pacs\s*(error|issue|problem|not working|crash|display|monitor|screen|config)/i,
      /hanging\s*protocol\s*(not|fail|wrong|missing|issue)/i,
      /multi[\s-]?monitor\s*(setup|config|display|layout|issue|problem)/i,
      /(monitor|screen|display)\s*(setup|config|layout|arrangement|issue|problem|fix)/i,
    ],
    priority: 8,
  },
  {
    id: 'it-dictation',
    label: 'Dictation / Fluency',
    category: 'GENERAL',
    keywords: [
      'fluency', 'dictation', 'speech recognition', 'mmodal', 'm*modal',
      'voice command', 'microphone', 'speech box', 'voice profile',
      'mobile mic', 'dictate'
    ],
    patterns: [
      /fluency\s*(direct|for imaging|error|issue|not working|crash|slow)/i,
      /(dictation|speech)\s*(not|issue|problem|error|fail|slow|lag)/i,
      /microphone\s*(not|issue|setup|calibrat|pair)/i,
      /voice\s*(command|recognition|profile)\s*(not|issue|error|fail)?/i,
    ],
    priority: 8,
  },
  {
    id: 'it-epic',
    label: 'Epic / EMR',
    category: 'GENERAL',
    keywords: [
      'epic', 'haiku', 'radiant', 'hyperspace', 'hyperdrive', 'emr',
      'context launch', 'order entry', 'accession', 'downtime'
    ],
    patterns: [
      /epic\s*(error|issue|not working|crash|slow|login|context|radiant)/i,
      /haiku\s*(error|issue|not working|login|biometric)/i,
      /context\s*launch\s*(fail|error|wrong|issue)/i,
      /radiant\s*(error|issue|not working|worklist)/i,
    ],
    priority: 8,
  },
  {
    id: 'it-medicalis',
    label: 'Medicalis / Worklist',
    category: 'GENERAL',
    keywords: [
      'medicalis', 'worklist', 'siemens', 'workflow state',
      'stuck order', 'routing', 'work list'
    ],
    patterns: [
      /medicalis\s*(error|issue|not working|stuck|worklist)/i,
      /worklist\s*(not|issue|empty|missing|wrong|stuck|filter)/i,
    ],
    priority: 7,
  },
  {
    id: 'it-workstation',
    label: 'Workstation / IT General',
    category: 'GENERAL',
    keywords: [
      'workstation', 'thin client', 'citrix', 'vpn', 'remote desktop',
      'login', 'password', 'network', 'connectivity', 'error code'
    ],
    patterns: [
      /workstation\s*(setup|issue|error|not working|crash|freeze|slow)/i,
      /(can'?t|cannot|unable\s*to)\s*(log\s*in|connect|access|open|start)/i,
      /(not|won'?t)\s*(loading|working|responding|connecting|displaying|starting)/i,
      /error\s*(code|message)\s*\d*/i,
    ],
    priority: 6,
  },
];

// Reaction symptoms that suggest contrast reaction when combined with contrast context
const REACTION_SYMPTOMS = /\b(itch|scratch|swell|swollen|swelling|rash|hive|breath|wheez|flush|nausea|vomit|throat|face|lip|tongue|dizz|faint|shock|tingle|numb|tight|choking|cough|sneez|runny|watery eyes|red|blotch|welt|bump|hot|warm|burn|sting|pain after)/i;

// Words indicating contrast/injection context
const CONTRAST_CONTEXT = /\b(contrast|iodine|iodinated|gadolinium|gad|dye|ct scan|mri|injection|injected|iv |intravenous|after (the )?(scan|study|exam|injection|ct|mri))/i;

/**
 * Detect topics in user query
 */
export function detectTopics(query: string): DetectedTopic[] {
  const detected: DetectedTopic[] = [];
  const queryLower = query.toLowerCase();

  // SPECIAL CASE: Symptom + Contrast = Contrast Reaction
  // This catches queries like "itchy chest after contrast" that wouldn't match exact keywords
  const hasSymptoms = REACTION_SYMPTOMS.test(query);
  const hasContrastContext = CONTRAST_CONTEXT.test(query);
  
  if (hasSymptoms && hasContrastContext) {
    const contrastReactionTopic = TOPIC_DEFINITIONS.find(t => t.id === 'contrast-reaction');
    if (contrastReactionTopic) {
      const symptomMatch = query.match(REACTION_SYMPTOMS);
      const contextMatch = query.match(CONTRAST_CONTEXT);
      detected.push({
        topic: contrastReactionTopic,
        confidence: 0.85, // High confidence when both symptoms and contrast present
        matchedTerms: [symptomMatch?.[0] || 'symptom', contextMatch?.[0] || 'contrast'].filter(Boolean),
      });
    }
  }

  for (const topic of TOPIC_DEFINITIONS) {
    // Skip contrast-reaction if we already added it via symptom detection
    if (topic.id === 'contrast-reaction' && detected.some(d => d.topic.id === 'contrast-reaction')) {
      continue;
    }
    
    let confidence = 0;
    const matchedTerms: string[] = [];

    // Check keyword matches
    for (const keyword of topic.keywords) {
      if (queryLower.includes(keyword.toLowerCase())) {
        matchedTerms.push(keyword);
        // Longer keyword matches = higher confidence
        confidence += 0.3 + (keyword.length / 50);
      }
    }

    // Check pattern matches
    for (const pattern of topic.patterns) {
      const match = query.match(pattern);
      if (match) {
        matchedTerms.push(match[0]);
        confidence += 0.4; // Pattern matches are stronger signals
      }
    }

    // Cap confidence at 1.0 and add priority bonus
    if (confidence > 0) {
      confidence = Math.min(1.0, confidence + (topic.priority / 100));
      detected.push({ topic, confidence, matchedTerms });
    }
  }

  // Sort by confidence descending
  return detected.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Analyze query and determine if topic clarification is needed
 */
export function analyzeTopics(query: string): TopicAnalysis {
  const detected = detectTopics(query);
  
  if (detected.length === 0) {
    return {
      detectedTopics: [],
      primaryTopic: null,
      needsClarification: false,
      suggestedTopics: [],
    };
  }

  const primaryTopic = detected[0];
  
  // Show clarification when topics are detected to confirm understanding
  // Only skip if confidence is extremely high (>0.9) with no competing topics
  const competingTopics = detected.filter(
    d => d.topic.id !== primaryTopic.topic.id && 
         (primaryTopic.confidence - d.confidence) < 0.25
  );

  // Show clarification for most queries - let user confirm the detected topic
  // Only auto-proceed silently if very high confidence AND no competing topics
  const needsClarification = 
    primaryTopic.confidence >= 0.3 && 
    (primaryTopic.confidence < 0.9 || competingTopics.length > 0);

  // Build suggested topics for UI (top 3 distinct categories)
  const seenCategories = new Set<string>();
  const suggestedTopics: TopicAnalysis['suggestedTopics'] = [];
  
  for (const d of detected) {
    if (suggestedTopics.length >= 3) break;
    if (seenCategories.has(d.topic.category)) continue;
    
    seenCategories.add(d.topic.category);
    suggestedTopics.push({
      id: d.topic.id,
      label: d.topic.label,
      category: d.topic.category,
      confidence: d.confidence,
    });
  }

  return {
    detectedTopics: detected,
    primaryTopic,
    needsClarification,
    suggestedTopics,
  };
}

/**
 * Get the category to boost based on topic analysis
 * Returns null if no clear topic or clarification is needed
 */
export function getBoostCategory(analysis: TopicAnalysis): string | null {
  if (!analysis.primaryTopic) return null;
  
  // Only auto-boost if confidence is high and no clarification needed
  if (analysis.primaryTopic.confidence >= 0.6 && !analysis.needsClarification) {
    return analysis.primaryTopic.topic.category;
  }
  
  return null;
}
