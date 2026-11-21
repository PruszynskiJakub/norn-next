/**
 * The checks every kernel document passes before anything reads it. Errors are JSON pointers, so a
 * corrupt unit or a refused fact names the exact place that failed.
 */
import { check, type ValidationResult } from "@norn/schema";
import { SharedWorkflowDocument, WorkflowDocument, WorkflowFile } from "../workflow/document.ts";
import { WorkflowGraph } from "../workflow/graph.ts";
import { Decision } from "./actions.ts";
import { KernelConfig } from "./config.ts";
import { KernelFacts } from "./facts.ts";
import { MailboxLetter, ReceiptData } from "./receipts.ts";
import { RunState } from "./run-state.ts";

export const validateKernelFacts = (v: unknown): ValidationResult<KernelFacts> => check(KernelFacts, v);
export const validateKernelConfig = (v: unknown): ValidationResult<KernelConfig> => check(KernelConfig, v);
export const validateRunState = (v: unknown): ValidationResult<RunState> => check(RunState, v);
export const validateReceiptData = (v: unknown): ValidationResult<ReceiptData> => check(ReceiptData, v);
export const validateMailboxLetter = (v: unknown): ValidationResult<MailboxLetter> => check(MailboxLetter, v);
export const validateDecision = (v: unknown): ValidationResult<Decision> => check(Decision, v);
export const validateWorkflowDocument = (v: unknown): ValidationResult<WorkflowDocument> => check(WorkflowDocument, v);
export const validateWorkflowFile = (v: unknown): ValidationResult<WorkflowFile> => check(WorkflowFile, v);
export const validateSharedWorkflowDocument = (v: unknown): ValidationResult<SharedWorkflowDocument> => check(SharedWorkflowDocument, v);
export const validateWorkflowGraph = (v: unknown): ValidationResult<WorkflowGraph> => check(WorkflowGraph, v);
