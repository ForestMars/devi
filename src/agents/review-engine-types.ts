// src/review-engine-types.ts

export interface PRFile {
  sha: string;
  filename: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch: string;
}

export interface ReviewFinding {
  severity: 'high' | 'medium';
  category: 'security' | 'bug' | 'performance';
  filename: string;
  message: string;
  suggestion: string;
  line?: number;
}

export interface FilterStats {
  total: number;
  reviewed: number;
  ignored: number;
  tooLarge: number;
}

export interface PostReviewContext {
    llmName: string;
    modelName: string;
    filterStats?: FilterStats;
}