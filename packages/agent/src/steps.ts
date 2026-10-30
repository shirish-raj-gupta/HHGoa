// What the stage screen shows for each agent, step by step.

export type StepKind = 'search' | 'open' | 'tool' | 'payment' | 'verify' | 'answer' | 'note' | 'error';

export interface AgentStep {
  at: number;
  kind: StepKind;
  label: string;
  detail?: unknown;
}

export type OnStep = (step: AgentStep) => void;

export function stepper(onStep?: OnStep) {
  const steps: AgentStep[] = [];
  const push = (kind: StepKind, label: string, detail?: unknown) => {
    const s: AgentStep = { at: Date.now(), kind, label, detail };
    steps.push(s);
    onStep?.(s);
    return s;
  };
  return { steps, push };
}
