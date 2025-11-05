export type ExperimentArgs = {
  experimentPath: string;
  evalPath: string;
  projectPath: string;
  resultsPath: string;
  verbose: boolean;
}

export type ExecutionSummary = { 
  cost: number;
  duration: number;
  durationApi: number;
  turns: number;
}

export type EvaluationSummary = {
  buildSuccess: boolean;
  typeCheckSuccess: boolean;
  lintSuccess: boolean;
  testSuccess: boolean;
  a11ySuccess: boolean;
}
