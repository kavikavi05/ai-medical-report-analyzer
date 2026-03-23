export interface MedicalTest {
  name: string;
  value: string;
  normal_range: string;
  status: 'Normal' | 'High' | 'Low' | 'Abnormal' | 'Unknown';
  explanation: string;
}

export interface AnalysisResult {
  tests: MedicalTest[];
  summary: string;
  recommendations?: string[];
}

export interface SavedAnalysis extends AnalysisResult {
  id: string;
  uid: string;
  fileName: string;
  createdAt: string;
}
