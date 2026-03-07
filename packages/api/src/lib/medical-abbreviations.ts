/**
 * Medical Abbreviations Dictionary
 * Source: Standard medical abbreviation references
 * 
 * Structure:
 * - key: uppercase abbreviation
 * - value: array of possible meanings (multiple = ambiguous)
 */

export interface AbbreviationEntry {
  meanings: string[];
  category?: string; // e.g., 'cardiology', 'neurology', 'general'
  dangerous?: boolean; // If misinterpretation could cause harm
}

export const MEDICAL_ABBREVIATIONS: Record<string, AbbreviationEntry> = {
  // === HIGH-RISK AMBIGUOUS (multiple meanings, clinical impact) ===
  'MS': {
    meanings: ['multiple sclerosis', 'mitral stenosis', 'morphine sulfate', 'musculoskeletal'],
    category: 'multi',
    dangerous: true,
  },
  'PT': {
    meanings: ['prothrombin time', 'physical therapy', 'patient'],
    category: 'multi',
    dangerous: true,
  },
  'RA': {
    meanings: ['rheumatoid arthritis', 'right atrium', 'room air'],
    category: 'multi',
    dangerous: true,
  },
  'PE': {
    meanings: ['pulmonary embolism', 'physical examination', 'pleural effusion'],
    category: 'multi',
    dangerous: true,
  },
  'CP': {
    meanings: ['cerebral palsy', 'chest pain', 'cleft palate'],
    category: 'multi',
    dangerous: true,
  },
  'CA': {
    meanings: ['cancer', 'coronary artery', 'cardiac arrest', 'calcium'],
    category: 'multi',
    dangerous: true,
  },
  'AS': {
    meanings: ['aortic stenosis', 'ankylosing spondylitis', 'left ear (auris sinistra)'],
    category: 'multi',
    dangerous: true,
  },
  'AF': {
    meanings: ['atrial fibrillation', 'atrial flutter', 'amniotic fluid'],
    category: 'cardiology',
    dangerous: true,
  },
  'BS': {
    meanings: ['blood sugar', 'bowel sounds', 'breath sounds'],
    category: 'multi',
    dangerous: false,
  },
  'HR': {
    meanings: ['heart rate', 'hour'],
    category: 'cardiology',
    dangerous: false,
  },
  'BP': {
    meanings: ['blood pressure', 'British Pharmacopeia'],
    category: 'cardiology',
    dangerous: false,
  },
  'IV': {
    meanings: ['intravenous', 'four (Roman numeral)'],
    category: 'general',
    dangerous: false,
  },
  'IM': {
    meanings: ['intramuscular', 'infectious mononucleosis'],
    category: 'general',
    dangerous: true,
  },
  'SC': {
    meanings: ['subcutaneous', 'spinal cord'],
    category: 'general',
    dangerous: true,
  },
  'US': {
    meanings: ['ultrasound', 'United States'],
    category: 'imaging',
    dangerous: false,
  },
  'MR': {
    meanings: ['magnetic resonance', 'mitral regurgitation', 'mental retardation'],
    category: 'multi',
    dangerous: true,
  },
  'RF': {
    meanings: ['rheumatoid factor', 'renal failure', 'radiofrequency'],
    category: 'multi',
    dangerous: true,
  },
  'TB': {
    meanings: ['tuberculosis', 'total bilirubin'],
    category: 'multi',
    dangerous: true,
  },
  'DM': {
    meanings: ['diabetes mellitus', 'diastolic murmur'],
    category: 'multi',
    dangerous: true,
  },
  'CHF': {
    meanings: ['congestive heart failure', 'chronic heart failure'],
    category: 'cardiology',
    dangerous: false, // Same condition, different terminology
  },
  'MI': {
    meanings: ['myocardial infarction', 'mitral insufficiency'],
    category: 'cardiology',
    dangerous: true,
  },
  'VT': {
    meanings: ['ventricular tachycardia', 'tidal volume'],
    category: 'cardiology',
    dangerous: true,
  },
  'VF': {
    meanings: ['ventricular fibrillation', 'visual field'],
    category: 'multi',
    dangerous: true,
  },
  
  // === UNAMBIGUOUS COMMON ABBREVIATIONS ===
  'AAA': {
    meanings: ['abdominal aortic aneurysm'],
    category: 'vascular',
  },
  'ABG': {
    meanings: ['arterial blood gas'],
    category: 'pulmonology',
  },
  'ACLS': {
    meanings: ['advanced cardiac life support'],
    category: 'emergency',
  },
  'ACS': {
    meanings: ['acute coronary syndrome'],
    category: 'cardiology',
  },
  'ADHD': {
    meanings: ['attention deficit-hyperactivity disorder'],
    category: 'psychiatry',
  },
  'ADL': {
    meanings: ['activities of daily living'],
    category: 'general',
  },
  'AED': {
    meanings: ['automated external defibrillator', 'antiepileptic drug'],
    category: 'multi',
    dangerous: true,
  },
  'AFB': {
    meanings: ['acid-fast bacillus'],
    category: 'infectious',
  },
  'AIDS': {
    meanings: ['acquired immunodeficiency syndrome'],
    category: 'infectious',
  },
  'AKI': {
    meanings: ['acute kidney injury'],
    category: 'nephrology',
  },
  'ALS': {
    meanings: ['amyotrophic lateral sclerosis', 'advanced life support'],
    category: 'multi',
    dangerous: true,
  },
  'ALT': {
    meanings: ['alanine aminotransferase'],
    category: 'laboratory',
  },
  'ANA': {
    meanings: ['antinuclear antibody'],
    category: 'rheumatology',
  },
  'ARDS': {
    meanings: ['acute respiratory distress syndrome'],
    category: 'pulmonology',
  },
  'AST': {
    meanings: ['aspartate aminotransferase'],
    category: 'laboratory',
  },
  'AVM': {
    meanings: ['arteriovenous malformation'],
    category: 'vascular',
  },
  'BID': {
    meanings: ['twice a day'],
    category: 'dosing',
  },
  'BLS': {
    meanings: ['basic life support'],
    category: 'emergency',
  },
  'BMP': {
    meanings: ['basic metabolic panel'],
    category: 'laboratory',
  },
  'BMI': {
    meanings: ['body mass index'],
    category: 'general',
  },
  'BNP': {
    meanings: ['brain natriuretic peptide', 'B-type natriuretic peptide'],
    category: 'cardiology',
  },
  'BPH': {
    meanings: ['benign prostatic hyperplasia'],
    category: 'urology',
  },
  'BUN': {
    meanings: ['blood urea nitrogen'],
    category: 'laboratory',
  },
  'CABG': {
    meanings: ['coronary artery bypass graft'],
    category: 'cardiology',
  },
  'CAD': {
    meanings: ['coronary artery disease'],
    category: 'cardiology',
  },
  'CBC': {
    meanings: ['complete blood count'],
    category: 'laboratory',
  },
  'CF': {
    meanings: ['cystic fibrosis'],
    category: 'pulmonology',
  },
  'CIED': {
    meanings: ['cardiovascular implantable electronic device'],
    category: 'cardiology',
  },
  'CKD': {
    meanings: ['chronic kidney disease'],
    category: 'nephrology',
  },
  'CMP': {
    meanings: ['comprehensive metabolic panel'],
    category: 'laboratory',
  },
  'CNS': {
    meanings: ['central nervous system'],
    category: 'neurology',
  },
  'COPD': {
    meanings: ['chronic obstructive pulmonary disease'],
    category: 'pulmonology',
  },
  'CPR': {
    meanings: ['cardiopulmonary resuscitation'],
    category: 'emergency',
  },
  'CRP': {
    meanings: ['C-reactive protein'],
    category: 'laboratory',
  },
  'CSF': {
    meanings: ['cerebrospinal fluid'],
    category: 'neurology',
  },
  'CT': {
    meanings: ['computed tomography'],
    category: 'imaging',
  },
  'CTA': {
    meanings: ['computed tomography angiography'],
    category: 'imaging',
  },
  'CVA': {
    meanings: ['cerebrovascular accident', 'costovertebral angle'],
    category: 'multi',
    dangerous: true,
  },
  'CXR': {
    meanings: ['chest x-ray'],
    category: 'imaging',
  },
  'D5W': {
    meanings: ['5% dextrose in water'],
    category: 'fluids',
  },
  'DKA': {
    meanings: ['diabetic ketoacidosis'],
    category: 'endocrinology',
  },
  'DNR': {
    meanings: ['do not resuscitate'],
    category: 'general',
  },
  'DVT': {
    meanings: ['deep vein thrombosis'],
    category: 'vascular',
  },
  'ECG': {
    meanings: ['electrocardiogram'],
    category: 'cardiology',
  },
  'EKG': {
    meanings: ['electrocardiogram'],
    category: 'cardiology',
  },
  'EEG': {
    meanings: ['electroencephalogram'],
    category: 'neurology',
  },
  'EF': {
    meanings: ['ejection fraction'],
    category: 'cardiology',
  },
  'EGFR': {
    meanings: ['estimated glomerular filtration rate', 'epidermal growth factor receptor'],
    category: 'multi',
    dangerous: true,
  },
  'EMG': {
    meanings: ['electromyogram'],
    category: 'neurology',
  },
  'EMS': {
    meanings: ['emergency medical services'],
    category: 'emergency',
  },
  'ENT': {
    meanings: ['ear, nose, and throat'],
    category: 'specialty',
  },
  'ERCP': {
    meanings: ['endoscopic retrograde cholangiopancreatography'],
    category: 'gastroenterology',
  },
  'ESR': {
    meanings: ['erythrocyte sedimentation rate'],
    category: 'laboratory',
  },
  'ESRD': {
    meanings: ['end-stage renal disease'],
    category: 'nephrology',
  },
  'ETOH': {
    meanings: ['ethyl alcohol', 'ethanol'],
    category: 'general',
  },
  'FBS': {
    meanings: ['fasting blood sugar'],
    category: 'laboratory',
  },
  'FFP': {
    meanings: ['fresh frozen plasma'],
    category: 'hematology',
  },
  'FNA': {
    meanings: ['fine needle aspiration'],
    category: 'pathology',
  },
  'GERD': {
    meanings: ['gastroesophageal reflux disease'],
    category: 'gastroenterology',
  },
  'GFR': {
    meanings: ['glomerular filtration rate'],
    category: 'nephrology',
  },
  'GI': {
    meanings: ['gastrointestinal'],
    category: 'gastroenterology',
  },
  'GSW': {
    meanings: ['gunshot wound'],
    category: 'trauma',
  },
  'GTT': {
    meanings: ['glucose tolerance test', 'drops'],
    category: 'multi',
  },
  'H&P': {
    meanings: ['history and physical'],
    category: 'general',
  },
  'HCG': {
    meanings: ['human chorionic gonadotropin'],
    category: 'obstetrics',
  },
  'HCT': {
    meanings: ['hematocrit'],
    category: 'laboratory',
  },
  'HDL': {
    meanings: ['high-density lipoprotein'],
    category: 'laboratory',
  },
  'HEENT': {
    meanings: ['head, eyes, ears, nose, throat'],
    category: 'examination',
  },
  'HGB': {
    meanings: ['hemoglobin'],
    category: 'laboratory',
  },
  'HIV': {
    meanings: ['human immunodeficiency virus'],
    category: 'infectious',
  },
  'HTN': {
    meanings: ['hypertension'],
    category: 'cardiology',
  },
  'IBD': {
    meanings: ['inflammatory bowel disease'],
    category: 'gastroenterology',
  },
  'IBS': {
    meanings: ['irritable bowel syndrome'],
    category: 'gastroenterology',
  },
  'ICD': {
    meanings: ['implantable cardioverter-defibrillator', 'International Classification of Diseases'],
    category: 'multi',
    dangerous: true,
  },
  'ICU': {
    meanings: ['intensive care unit'],
    category: 'general',
  },
  'INR': {
    meanings: ['international normalized ratio'],
    category: 'laboratory',
  },
  'IOP': {
    meanings: ['intraocular pressure'],
    category: 'ophthalmology',
  },
  'IUD': {
    meanings: ['intrauterine device'],
    category: 'gynecology',
  },
  'IVC': {
    meanings: ['inferior vena cava', 'intravenous catheter'],
    category: 'multi',
  },
  'IVP': {
    meanings: ['intravenous pyelogram', 'intravenous push'],
    category: 'multi',
    dangerous: true,
  },
  'JVD': {
    meanings: ['jugular venous distention'],
    category: 'cardiology',
  },
  'KUB': {
    meanings: ['kidney, ureter, bladder'],
    category: 'imaging',
  },
  'LDH': {
    meanings: ['lactate dehydrogenase'],
    category: 'laboratory',
  },
  'LDL': {
    meanings: ['low-density lipoprotein'],
    category: 'laboratory',
  },
  'LFT': {
    meanings: ['liver function test'],
    category: 'laboratory',
  },
  'LLQ': {
    meanings: ['left lower quadrant'],
    category: 'anatomy',
  },
  'LMP': {
    meanings: ['last menstrual period'],
    category: 'obstetrics',
  },
  'LOC': {
    meanings: ['level of consciousness', 'loss of consciousness'],
    category: 'neurology',
  },
  'LP': {
    meanings: ['lumbar puncture'],
    category: 'neurology',
  },
  'LUQ': {
    meanings: ['left upper quadrant'],
    category: 'anatomy',
  },
  'LVH': {
    meanings: ['left ventricular hypertrophy'],
    category: 'cardiology',
  },
  'MRA': {
    meanings: ['magnetic resonance angiography'],
    category: 'imaging',
  },
  'MRI': {
    meanings: ['magnetic resonance imaging'],
    category: 'imaging',
  },
  'MRSA': {
    meanings: ['methicillin-resistant Staphylococcus aureus'],
    category: 'infectious',
  },
  'MVA': {
    meanings: ['motor vehicle accident'],
    category: 'trauma',
  },
  'NG': {
    meanings: ['nasogastric'],
    category: 'general',
  },
  'NICU': {
    meanings: ['neonatal intensive care unit'],
    category: 'pediatrics',
  },
  'NKDA': {
    meanings: ['no known drug allergies'],
    category: 'general',
  },
  'NPO': {
    meanings: ['nothing by mouth (nil per os)'],
    category: 'general',
  },
  'NSAID': {
    meanings: ['nonsteroidal anti-inflammatory drug'],
    category: 'pharmacology',
  },
  'NSR': {
    meanings: ['normal sinus rhythm'],
    category: 'cardiology',
  },
  'OD': {
    meanings: ['right eye (oculus dexter)', 'overdose', 'once daily'],
    category: 'multi',
    dangerous: true,
  },
  'OR': {
    meanings: ['operating room'],
    category: 'general',
  },
  'OS': {
    meanings: ['left eye (oculus sinister)'],
    category: 'ophthalmology',
  },
  'OTC': {
    meanings: ['over the counter'],
    category: 'pharmacology',
  },
  'OU': {
    meanings: ['both eyes (oculi uterque)'],
    category: 'ophthalmology',
  },
  'PACU': {
    meanings: ['post-anesthesia care unit'],
    category: 'general',
  },
  'PCA': {
    meanings: ['patient-controlled analgesia', 'posterior cerebral artery'],
    category: 'multi',
    dangerous: true,
  },
  'PCR': {
    meanings: ['polymerase chain reaction'],
    category: 'laboratory',
  },
  'PEEP': {
    meanings: ['positive end-expiratory pressure'],
    category: 'pulmonology',
  },
  'PET': {
    meanings: ['positron emission tomography'],
    category: 'imaging',
  },
  'PICC': {
    meanings: ['peripherally inserted central catheter'],
    category: 'general',
  },
  'PID': {
    meanings: ['pelvic inflammatory disease'],
    category: 'gynecology',
  },
  'PMH': {
    meanings: ['past medical history'],
    category: 'general',
  },
  'PO': {
    meanings: ['by mouth (per os)'],
    category: 'dosing',
  },
  'PRBC': {
    meanings: ['packed red blood cells'],
    category: 'hematology',
  },
  'PRN': {
    meanings: ['as needed (pro re nata)'],
    category: 'dosing',
  },
  'PSA': {
    meanings: ['prostate-specific antigen'],
    category: 'urology',
  },
  'PTT': {
    meanings: ['partial thromboplastin time'],
    category: 'laboratory',
  },
  'PVC': {
    meanings: ['premature ventricular contraction'],
    category: 'cardiology',
  },
  'QD': {
    meanings: ['once daily'],
    category: 'dosing',
    dangerous: true, // Often confused with QID
  },
  'QID': {
    meanings: ['four times a day'],
    category: 'dosing',
  },
  'QOD': {
    meanings: ['every other day'],
    category: 'dosing',
    dangerous: true, // Often misread
  },
  'RBC': {
    meanings: ['red blood cell'],
    category: 'laboratory',
  },
  'RLQ': {
    meanings: ['right lower quadrant'],
    category: 'anatomy',
  },
  'ROM': {
    meanings: ['range of motion', 'rupture of membranes'],
    category: 'multi',
    dangerous: true,
  },
  'ROS': {
    meanings: ['review of systems'],
    category: 'general',
  },
  'RUQ': {
    meanings: ['right upper quadrant'],
    category: 'anatomy',
  },
  'RX': {
    meanings: ['prescription', 'treatment'],
    category: 'general',
  },
  'SBP': {
    meanings: ['systolic blood pressure', 'spontaneous bacterial peritonitis'],
    category: 'multi',
    dangerous: true,
  },
  'SL': {
    meanings: ['sublingual'],
    category: 'dosing',
  },
  'SLE': {
    meanings: ['systemic lupus erythematosus'],
    category: 'rheumatology',
  },
  'SOB': {
    meanings: ['shortness of breath'],
    category: 'pulmonology',
  },
  'SPO2': {
    meanings: ['oxygen saturation by pulse oximetry'],
    category: 'pulmonology',
  },
  'STAT': {
    meanings: ['immediately'],
    category: 'general',
  },
  'STD': {
    meanings: ['sexually transmitted disease'],
    category: 'infectious',
  },
  'STI': {
    meanings: ['sexually transmitted infection'],
    category: 'infectious',
  },
  'SVC': {
    meanings: ['superior vena cava'],
    category: 'anatomy',
  },
  'SVT': {
    meanings: ['supraventricular tachycardia'],
    category: 'cardiology',
  },
  'T3': {
    meanings: ['triiodothyronine'],
    category: 'endocrinology',
  },
  'T4': {
    meanings: ['thyroxine'],
    category: 'endocrinology',
  },
  'TAH': {
    meanings: ['total abdominal hysterectomy'],
    category: 'gynecology',
  },
  'TIA': {
    meanings: ['transient ischemic attack'],
    category: 'neurology',
  },
  'TIBC': {
    meanings: ['total iron-binding capacity'],
    category: 'laboratory',
  },
  'TID': {
    meanings: ['three times a day'],
    category: 'dosing',
  },
  'TKR': {
    meanings: ['total knee replacement'],
    category: 'orthopedics',
  },
  'TPA': {
    meanings: ['tissue plasminogen activator'],
    category: 'hematology',
  },
  'TPN': {
    meanings: ['total parenteral nutrition'],
    category: 'nutrition',
  },
  'TSH': {
    meanings: ['thyroid-stimulating hormone'],
    category: 'endocrinology',
  },
  'UA': {
    meanings: ['urinalysis', 'unstable angina'],
    category: 'multi',
    dangerous: true,
  },
  'URI': {
    meanings: ['upper respiratory infection'],
    category: 'pulmonology',
  },
  'UTI': {
    meanings: ['urinary tract infection'],
    category: 'urology',
  },
  'VDRL': {
    meanings: ['Venereal Disease Research Laboratory'],
    category: 'laboratory',
  },
  'VS': {
    meanings: ['vital signs'],
    category: 'general',
  },
  'VSD': {
    meanings: ['ventricular septal defect'],
    category: 'cardiology',
  },
  'WBC': {
    meanings: ['white blood cell'],
    category: 'laboratory',
  },
  'WNL': {
    meanings: ['within normal limits'],
    category: 'general',
  },
  
  // === RADIOLOGY IMAGING ABBREVIATIONS ===
  'FLAIR': {
    meanings: ['fluid-attenuated inversion recovery'],
    category: 'neuroradiology',
  },
  'DWI': {
    meanings: ['diffusion-weighted imaging'],
    category: 'neuroradiology',
  },
  'ADC': {
    meanings: ['apparent diffusion coefficient'],
    category: 'neuroradiology',
  },
  'SWI': {
    meanings: ['susceptibility-weighted imaging'],
    category: 'neuroradiology',
  },
  'GRE': {
    meanings: ['gradient recalled echo', 'Graduate Record Examination'],
    category: 'radiology',
    dangerous: true,
  },
  'MRCP': {
    meanings: ['magnetic resonance cholangiopancreatography'],
    category: 'abdominal',
  },
  'SBO': {
    meanings: ['small bowel obstruction'],
    category: 'abdominal',
  },
  'STIR': {
    meanings: ['short tau inversion recovery'],
    category: 'radiology',
  },
  'TOF': {
    meanings: ['time of flight'],
    category: 'vascular',
  },
  'HU': {
    meanings: ['Hounsfield unit'],
    category: 'radiology',
  },
  'SUV': {
    meanings: ['standardized uptake value'],
    category: 'nuclear medicine',
  },
  'BIRADS': {
    meanings: ['Breast Imaging Reporting and Data System'],
    category: 'breast',
  },
  'LIRADS': {
    meanings: ['Liver Imaging Reporting and Data System'],
    category: 'abdominal',
  },
  'TIRADS': {
    meanings: ['Thyroid Imaging Reporting and Data System'],
    category: 'head and neck',
  },
  'PIRADS': {
    meanings: ['Prostate Imaging Reporting and Data System'],
    category: 'abdominal',
  },
  'CTPA': {
    meanings: ['CT pulmonary angiography'],
    category: 'chest',
  },
  'CTP': {
    meanings: ['CT perfusion'],
    category: 'neuroradiology',
  },
  'AML': {
    meanings: ['angiomyolipoma', 'acute myeloid leukemia'],
    category: 'radiology',
    dangerous: true,
  },
  'IR': {
    meanings: ['interventional radiology', 'infrared'],
    category: 'radiology',
    dangerous: true,
  },
  'FAST': {
    meanings: ['focused assessment with sonography in trauma'],
    category: 'emergency',
  },

  // === CONTRAST/RADIOLOGY SPECIFIC ===
  'CM': {
    meanings: ['contrast media', 'centimeter'],
    category: 'multi',
  },
  'ICM': {
    meanings: ['iodinated contrast media'],
    category: 'radiology',
  },
  'GBCA': {
    meanings: ['gadolinium-based contrast agent'],
    category: 'radiology',
  },
  'NSF': {
    meanings: ['nephrogenic systemic fibrosis'],
    category: 'radiology',
  },
  'CIN': {
    meanings: ['contrast-induced nephropathy', 'cervical intraepithelial neoplasia'],
    category: 'multi',
    dangerous: true,
  },
  'SCR': {
    meanings: ['serum creatinine'],
    category: 'laboratory',
  },
};

// Abbreviations that are particularly dangerous if misinterpreted
export const HIGH_RISK_ABBREVIATIONS = Object.entries(MEDICAL_ABBREVIATIONS)
  .filter(([_, entry]) => entry.dangerous)
  .map(([abbr]) => abbr);

// Abbreviations with multiple meanings
export const AMBIGUOUS_ABBREVIATIONS = Object.entries(MEDICAL_ABBREVIATIONS)
  .filter(([_, entry]) => entry.meanings.length > 1)
  .map(([abbr]) => abbr);

/**
 * Get all possible meanings for an abbreviation
 */
export function getAbbreviationMeanings(abbr: string): AbbreviationEntry | null {
  const normalized = abbr.toUpperCase().trim();
  return MEDICAL_ABBREVIATIONS[normalized] || null;
}

/**
 * Check if an abbreviation is ambiguous (has multiple meanings)
 */
export function isAmbiguous(abbr: string): boolean {
  const entry = getAbbreviationMeanings(abbr);
  return entry ? entry.meanings.length > 1 : false;
}

/**
 * Check if an abbreviation is high-risk (dangerous if misinterpreted)
 */
export function isHighRisk(abbr: string): boolean {
  const entry = getAbbreviationMeanings(abbr);
  return entry?.dangerous ?? false;
}
