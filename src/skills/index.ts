export { SkillRegistry } from './registry';
export type {
  Skill,
  BaseSkill,
  ScriptSkill,
  ScriptStep,
  PromptSkill,
  ActionSkill,
  ActionSkillContext,
  SurfaceSkill,
  SurfaceSkillContext,
  PanelSkill,
  PanelSkillContext,
  SkillTools,
  SurfacePlacement,
} from './types';

// v0.2.0 ROADMAP 2.6 — multi-step transaction with rollback
export { runTransaction } from './transaction';
export type {
  TransactionStep,
  TransactionOpts,
  TransactionOutcome,
} from './transaction';
