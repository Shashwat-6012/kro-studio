import { parse, stringify } from 'yaml';
import type { K8sObject } from '../api/types';

export const toYaml = (value: unknown) => stringify(value, { lineWidth: 0 });

export type ParseResult = { value: K8sObject | null; error: string | null };

export function parseManifest(text: string): ParseResult {
  if (!text.trim()) return { value: null, error: 'The manifest is empty.' };
  try {
    const value = parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { value: null, error: 'The manifest must be a single YAML object.' };
    return { value: value as K8sObject, error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message.split('\n')[0] : 'Invalid YAML.' };
  }
}

/** Removes server-owned noise before showing a manifest in an editor. */
export function cleanForEdit(manifest: K8sObject): K8sObject {
  const { status: _status, ...rest } = manifest;
  const metadata = { ...(rest.metadata ?? {}) } as Record<string, unknown>;
  delete metadata.managedFields;
  return { ...rest, metadata };
}
