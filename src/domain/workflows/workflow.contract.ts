export type WorkflowIntent = {
  id: string;
  objective: string;
  audience?: string;
  channels?: string[];
  constraints?: string[];
  successCriteria?: string[];
};

export type WorkflowStep = {
  id: string;
  name: string;
  requiredSkillCapability: string;
  dependsOn: string[];
  inputRefs: string[];
  outputRef: string;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  intent: WorkflowIntent;
  steps: WorkflowStep[];
};
