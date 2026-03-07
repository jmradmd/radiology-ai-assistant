import { 
  MEDICAL_ABBREVIATIONS, 
  getAbbreviationMeanings,
  type AbbreviationEntry,
} from './medical-abbreviations';

export interface DetectedAbbreviation {
  abbreviation: string;
  position: number;
  entry: AbbreviationEntry;
  isAmbiguous: boolean;
  isHighRisk: boolean;
  context: string; // Surrounding text for context
}

export interface AbbreviationAnalysis {
  detectedAbbreviations: DetectedAbbreviation[];
  ambiguousAbbreviations: DetectedAbbreviation[];
  highRiskAbbreviations: DetectedAbbreviation[];
  needsClarification: boolean;
  clarificationPrompt?: string;
}

/**
 * Detect medical abbreviations in text
 */
export function detectAbbreviations(text: string): DetectedAbbreviation[] {
  const detected: DetectedAbbreviation[] = [];
  const words = text.split(/\s+/);
  
  let position = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Clean the word (remove punctuation, but keep the original for position)
    const cleaned = word.replace(/[.,;:?!()[\]{}'"]/g, '').toUpperCase();
    
    // Check if it's in our dictionary
    const entry = getAbbreviationMeanings(cleaned);
    
    if (entry) {
      // Get surrounding context (5 words before and after)
      const contextStart = Math.max(0, i - 5);
      const contextEnd = Math.min(words.length, i + 6);
      const context = words.slice(contextStart, contextEnd).join(' ');
      
      detected.push({
        abbreviation: cleaned,
        position,
        entry,
        isAmbiguous: entry.meanings.length > 1,
        isHighRisk: entry.dangerous ?? false,
        context,
      });
    }
    
    position += word.length + 1; // +1 for space
  }
  
  return detected;
}

/**
 * Analyze abbreviations and determine if clarification is needed
 * 
 * Important: We try to resolve ambiguous abbreviations from context BEFORE
 * deciding if clarification is needed. This prevents unnecessary prompts
 * when context makes the meaning clear (e.g., "CVA" with "stroke" context).
 */
export function analyzeAbbreviations(text: string, categoryHint?: string): AbbreviationAnalysis {
  const detected = detectAbbreviations(text);
  const ambiguous = detected.filter(d => d.isAmbiguous);
  const highRisk = detected.filter(d => d.isHighRisk);
  
  // Try to resolve ambiguous abbreviations from context
  // Filter to only those that remain unresolved
  const unresolvedAmbiguous = ambiguous.filter(d => {
    const resolved = resolveFromContext(d.abbreviation, text, categoryHint);
    return resolved === null; // Still ambiguous after context check
  });
  
  const unresolvedHighRisk = unresolvedAmbiguous.filter(d => d.isHighRisk);
  
  // Need clarification only if:
  // 1. Any high-risk abbreviation is STILL ambiguous after context resolution
  // 2. Any abbreviation has >2 meanings and context doesn't resolve it
  const needsClarification = unresolvedHighRisk.length > 0 || 
                             unresolvedAmbiguous.some(d => d.entry.meanings.length > 2);
  
  let clarificationPrompt: string | undefined;
  
  if (needsClarification && unresolvedAmbiguous.length > 0) {
    // Build clarification prompt for the most critical unresolved abbreviation
    const mostCritical = unresolvedAmbiguous
      .sort((a, b) => {
        // Prioritize high-risk, then by number of meanings
        if (a.isHighRisk !== b.isHighRisk) return a.isHighRisk ? -1 : 1;
        return b.entry.meanings.length - a.entry.meanings.length;
      })[0];
    
    if (mostCritical) {
      const meanings = mostCritical.entry.meanings;
      clarificationPrompt = buildClarificationPrompt(mostCritical.abbreviation, meanings);
    }
  }
  
  return {
    detectedAbbreviations: detected,
    ambiguousAbbreviations: ambiguous,
    highRiskAbbreviations: highRisk,
    needsClarification,
    clarificationPrompt,
  };
}

/**
 * Build a user-friendly clarification prompt
 */
function buildClarificationPrompt(abbreviation: string, meanings: string[]): string {
  const formatted = meanings
    .map((m, i) => `${i + 1}. **${m}**`)
    .join('\n');
  
  return `I noticed you used "${abbreviation}" which can mean several things:\n\n${formatted}\n\nWhich meaning did you intend? (You can reply with the number or the full term)`;
}

/**
 * Context-based resolution rules for common abbreviations
 */
const CONTEXT_CLUES: Record<string, Record<string, string>> = {
  'MS': {
    'neuro': 'multiple sclerosis',
    'brain': 'multiple sclerosis',
    'demyelinating': 'multiple sclerosis',
    'lesion': 'multiple sclerosis',
    'plaque': 'multiple sclerosis',
    'cardiac': 'mitral stenosis',
    'valve': 'mitral stenosis',
    'heart': 'mitral stenosis',
    'murmur': 'mitral stenosis',
    'morphine': 'morphine sulfate',
    'opioid': 'morphine sulfate',
    'narcotic': 'morphine sulfate',
    'analgesic': 'morphine sulfate',
    'pain management medication': 'morphine sulfate',
    'drug': 'morphine sulfate',
  },
  'PT': {
    'coagulation': 'prothrombin time',
    'inr': 'prothrombin time',
    'warfarin': 'prothrombin time',
    'anticoagulation': 'prothrombin time',
    'therapy': 'physical therapy',
    'exercise': 'physical therapy',
    'rehabilitation': 'physical therapy',
    'mobility': 'physical therapy',
  },
  'RA': {
    'joint': 'rheumatoid arthritis',
    'arthritis': 'rheumatoid arthritis',
    'autoimmune': 'rheumatoid arthritis',
    'synovitis': 'rheumatoid arthritis',
    'cardiac': 'right atrium',
    'heart': 'right atrium',
    'atrial': 'right atrium',
    'echo': 'right atrium',
    'oxygen': 'room air',
    'saturation': 'room air',
    'spo2': 'room air',
  },
  'PE': {
    'embolism': 'pulmonary embolism',
    'chest': 'pulmonary embolism',
    'dvt': 'pulmonary embolism',
    'clot': 'pulmonary embolism',
    'anticoagulation': 'pulmonary embolism',
    'exam': 'physical examination',
    'physical': 'physical examination',
    'effusion': 'pleural effusion',
    'thoracentesis': 'pleural effusion',
  },
  'CA': {
    'cancer': 'cancer',
    'tumor': 'cancer',
    'malignant': 'cancer',
    'oncology': 'cancer',
    'metastasis': 'cancer',
    'coronary': 'coronary artery',
    'cardiac': 'coronary artery',
    'heart': 'coronary artery',
    'stent': 'coronary artery',
    'arrest': 'cardiac arrest',
    'code': 'cardiac arrest',
    'resuscitation': 'cardiac arrest',
  },
  'MI': {
    'infarction': 'myocardial infarction',
    'stemi': 'myocardial infarction',
    'nstemi': 'myocardial infarction',
    'troponin': 'myocardial infarction',
    'chest pain': 'myocardial infarction',
    'acs': 'myocardial infarction',
    'valve': 'mitral insufficiency',
    'regurgitation': 'mitral insufficiency',
    'murmur': 'mitral insufficiency',
  },
  'EGFR': {
    'kidney': 'estimated glomerular filtration rate',
    'renal': 'estimated glomerular filtration rate',
    'creatinine': 'estimated glomerular filtration rate',
    'contrast': 'estimated glomerular filtration rate',
    'nephrology': 'estimated glomerular filtration rate',
    'ckd': 'estimated glomerular filtration rate',
    'cancer': 'epidermal growth factor receptor',
    'oncology': 'epidermal growth factor receptor',
    'tumor': 'epidermal growth factor receptor',
    'lung': 'epidermal growth factor receptor',
    'nsclc': 'epidermal growth factor receptor',
  },
  'CIN': {
    'contrast': 'contrast-induced nephropathy',
    'kidney': 'contrast-induced nephropathy',
    'renal': 'contrast-induced nephropathy',
    'creatinine': 'contrast-induced nephropathy',
    'aki': 'contrast-induced nephropathy',
    'cervical': 'cervical intraepithelial neoplasia',
    'pap': 'cervical intraepithelial neoplasia',
    'hpv': 'cervical intraepithelial neoplasia',
    'dysplasia': 'cervical intraepithelial neoplasia',
  },
  'AF': {
    'fibrillation': 'atrial fibrillation',
    'rhythm': 'atrial fibrillation',
    'irregular': 'atrial fibrillation',
    'anticoagulation': 'atrial fibrillation',
    'rate control': 'atrial fibrillation',
    'flutter': 'atrial flutter',
    'pregnancy': 'amniotic fluid',
    'obstetric': 'amniotic fluid',
    'fetal': 'amniotic fluid',
  },
  'ICD': {
    'defibrillator': 'implantable cardioverter-defibrillator',
    'cardiac': 'implantable cardioverter-defibrillator',
    'shock': 'implantable cardioverter-defibrillator',
    'arrhythmia': 'implantable cardioverter-defibrillator',
    'vt': 'implantable cardioverter-defibrillator',
    'code': 'International Classification of Diseases',
    'diagnosis': 'International Classification of Diseases',
    'billing': 'International Classification of Diseases',
  },
  'AED': {
    'defibrillator': 'automated external defibrillator',
    'cpr': 'automated external defibrillator',
    'cardiac arrest': 'automated external defibrillator',
    'resuscitation': 'automated external defibrillator',
    'seizure': 'antiepileptic drug',
    'epilepsy': 'antiepileptic drug',
    'anticonvulsant': 'antiepileptic drug',
  },
  'ALS': {
    'neurodegenerative': 'amyotrophic lateral sclerosis',
    'motor neuron': 'amyotrophic lateral sclerosis',
    'weakness': 'amyotrophic lateral sclerosis',
    'fasciculation': 'amyotrophic lateral sclerosis',
    'ambulance': 'advanced life support',
    'ems': 'advanced life support',
    'paramedic': 'advanced life support',
  },
  'CVA': {
    'stroke': 'cerebrovascular accident',
    'neuro': 'cerebrovascular accident',
    'brain': 'cerebrovascular accident',
    'hemiplegia': 'cerebrovascular accident',
    'aphasia': 'cerebrovascular accident',
    'tenderness': 'costovertebral angle',
    'kidney': 'costovertebral angle',
    'flank': 'costovertebral angle',
  },
  'UA': {
    'urine': 'urinalysis',
    'uti': 'urinalysis',
    'dipstick': 'urinalysis',
    'angina': 'unstable angina',
    'chest': 'unstable angina',
    'acs': 'unstable angina',
  },
  'SBP': {
    'blood pressure': 'systolic blood pressure',
    'mmhg': 'systolic blood pressure',
    'hypertension': 'systolic blood pressure',
    'peritonitis': 'spontaneous bacterial peritonitis',
    'ascites': 'spontaneous bacterial peritonitis',
    'cirrhosis': 'spontaneous bacterial peritonitis',
    'liver': 'spontaneous bacterial peritonitis',
  },
  'ROM': {
    'motion': 'range of motion',
    'mobility': 'range of motion',
    'joint': 'range of motion',
    'physical therapy': 'range of motion',
    'membranes': 'rupture of membranes',
    'obstetric': 'rupture of membranes',
    'amniotic': 'rupture of membranes',
    'labor': 'rupture of membranes',
  },
  'PCA': {
    'analgesia': 'patient-controlled analgesia',
    'pain': 'patient-controlled analgesia',
    'morphine': 'patient-controlled analgesia',
    'pump': 'patient-controlled analgesia',
    'artery': 'posterior cerebral artery',
    'stroke': 'posterior cerebral artery',
    'occipital': 'posterior cerebral artery',
  },
  'OD': {
    'eye': 'right eye (oculus dexter)',
    'ophthalmology': 'right eye (oculus dexter)',
    'vision': 'right eye (oculus dexter)',
    'overdose': 'overdose',
    'toxicology': 'overdose',
    'ingestion': 'overdose',
    'daily': 'once daily',
    'medication': 'once daily',
    'dosing': 'once daily',
  },
};

/**
 * Try to resolve abbreviation meaning from context
 * Returns the most likely meaning or null if unclear
 */
export function resolveFromContext(
  abbreviation: string, 
  context: string,
  categoryHint?: string
): string | null {
  const entry = getAbbreviationMeanings(abbreviation);
  if (!entry) return null;
  
  // If only one meaning, return it
  if (entry.meanings.length === 1) {
    return entry.meanings[0];
  }
  
  const contextLower = context.toLowerCase();
  
  const clues = CONTEXT_CLUES[abbreviation.toUpperCase()];
  if (clues) {
    for (const [keyword, meaning] of Object.entries(clues)) {
      if (contextLower.includes(keyword)) {
        return meaning;
      }
    }
  }
  
  // Category-based hints for radiology context
  if (categoryHint) {
    const categoryLower = categoryHint.toLowerCase();
    
    // RENAL/CONTRAST category strongly suggests eGFR = glomerular filtration rate
    if (abbreviation.toUpperCase() === 'EGFR' && 
        (categoryLower.includes('renal') || categoryLower.includes('contrast'))) {
      return 'estimated glomerular filtration rate';
    }
    
    // MRI_SAFETY context for certain abbreviations
    if (categoryLower.includes('mri') || categoryLower.includes('safety')) {
      if (abbreviation.toUpperCase() === 'ICD') {
        return 'implantable cardioverter-defibrillator';
      }
    }
  }
  
  // Could not resolve
  return null;
}

/**
 * Expand abbreviations in query text for better retrieval
 * Only expands unambiguous abbreviations or those resolved from context
 */
export function expandAbbreviationsForRetrieval(
  text: string,
  categoryHint?: string
): { expandedText: string; expansions: Record<string, string> } {
  const detected = detectAbbreviations(text);
  const expansions: Record<string, string> = {};
  let expandedText = text;
  
  // Process in reverse order to maintain positions
  const sortedByPosition = [...detected].sort((a, b) => b.position - a.position);
  
  for (const det of sortedByPosition) {
    let resolvedMeaning: string | null = null;
    
    if (det.entry.meanings.length === 1) {
      // Unambiguous
      resolvedMeaning = det.entry.meanings[0];
    } else {
      // Try to resolve from context
      resolvedMeaning = resolveFromContext(det.abbreviation, text, categoryHint);
    }
    
    if (resolvedMeaning) {
      // Create expansion: "MS (multiple sclerosis)"
      const expansion = `${det.abbreviation} (${resolvedMeaning})`;
      expansions[det.abbreviation] = resolvedMeaning;
      
      // Replace in text (case-insensitive, word boundary)
      expandedText = expandedText.replace(
        new RegExp(`\\b${det.abbreviation}\\b`, 'i'),
        expansion
      );
    }
  }
  
  return { expandedText, expansions };
}
