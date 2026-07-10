export interface FrequencyItem {
  value: string;
  count: number;
  percentage: number;
}

export type VariableType = 'demographic' | 'categorical' | 'ordinal' | 'boolean' | 'numerical' | 'text';

export interface OutlierInfo {
  lowerBound: number;
  upperBound: number;
  count: number;
  percentage: number;
  values: number[];
  impactDescription: string;
  recommendation: string;
}

export interface ColumnProfile {
  name: string;
  type: VariableType;
  totalCount: number;
  validCount: number;
  missingCount: number;
  missingPercentage: number;
  frequencies: FrequencyItem[]; // Sorted descending
  mean?: number;
  stdDev?: number;
  min?: number;
  max?: number;
  outlierInfo?: OutlierInfo | null;
}

export interface CrosstabMatrix {
  [rowValue: string]: {
    [colValue: string]: {
      count: number;
      percentage: number; // Percentage of the row total
    };
  };
}

export interface CrosstabProfile {
  rowVar: string;
  colVar: string;
  matrix: CrosstabMatrix;
  rowValues: string[];
  colValues: string[];
  relationshipStrength: 'strong' | 'moderate' | 'weak' | 'none';
  relationshipType: 'direct' | 'inverse' | 'complex' | 'none';
  insight: string;
  cramersV?: number;
  chiSquare?: number;
}

export interface DatasetProfile {
  fileName: string;
  totalRecords: number;
  validRecords: number;
  columns: ColumnProfile[];
  crosstabs: CrosstabProfile[];
  sheetNames?: string[];
  selectedSheet?: string;
  rawDataRows?: any[];
  originalRawDataRows?: any[];
  removedDuplicatesCount?: number;
}

export interface AnalysisReport {
  executiveSummary: string;
  methodology: string;
  detailedInsights: string;
  relationshipsAnalysis: string;
  conclusionsAndRecommendations: string;
}
