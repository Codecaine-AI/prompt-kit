export type PromptDiagnosticSeverity = "error" | "warning";

export interface PromptDiagnostic {
  severity: PromptDiagnosticSeverity;
  code: string;
  message: string;
  path?: Array<string | number>;
  nodeId?: string;
}

export interface PromptValidationResult {
  ok: boolean;
  diagnostics: PromptDiagnostic[];
}
