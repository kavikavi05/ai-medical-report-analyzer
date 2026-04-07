export interface MedicalTest {
  name: string;
  value: string;
  unit?: string;
  numericValue?: number;
  normal_range: string;
  status: 'Normal' | 'High' | 'Low' | 'Abnormal' | 'Unknown';
  explanation: string;
  eli5_explanation: string;
}

export interface DiseasePrediction {
  disease: string;
  probability: 'Low' | 'Moderate' | 'High';
  reasoning: string;
}

export interface HealthSuggestions {
  diet: string[];
  exercise: string[];
  lifestyle: string[];
}

export interface AnalysisResult {
  tests: MedicalTest[];
  summary: string;
  recommendations?: string[];
  predictions?: DiseasePrediction[];
  healthSuggestions?: HealthSuggestions;
  isCritical?: boolean;
  criticalAlertMessage?: string;
}

export interface SavedAnalysis extends AnalysisResult {
  id: string;
  uid: string;
  fileName: string;
  createdAt: string;
  age?: number;
  gender?: string;
}
