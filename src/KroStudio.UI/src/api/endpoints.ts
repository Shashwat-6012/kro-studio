import { enc, jsonBody, qs, request } from './client';
import type {
  Capability, Connection, ContainerLog, Definition, EventsResponse, GeneratedApi, InstallationResult, InstancePage,
  InstanceResourcesResponse, K8sObject, KroInstallation, MessageResponse, RbacApplyRequest, RbacApplyResult, RbacPlan, RbacReport,
} from './types';

const base = '/api/v1';

export const clusterApi = {
  connection: () => request<Connection>(`${base}/connection`),
  capabilities: () => request<Capability>(`${base}/capabilities`),
  kroInstallation: () => request<KroInstallation>(`${base}/kro-installation`),
  installKro: () => request<InstallationResult>(`${base}/kro-installation`, { method: 'POST' }),
  restartController: () => request<MessageResponse>(`${base}/kro-controller/restart`, { method: 'POST' }),
};

export const definitionsApi = {
  list: () => request<Definition[]>(`${base}/rgds`),
  get: (name: string) => request<K8sObject>(`${base}/rgds/${enc(name)}`),
  generatedApi: (name: string) => request<GeneratedApi>(`${base}/rgds/${enc(name)}/api`),
  create: (yaml: string) => request<K8sObject>(`${base}/rgds`, { method: 'POST', body: jsonBody({ yaml }) }),
  update: (name: string, yaml: string) => request<K8sObject>(`${base}/rgds/${enc(name)}`, { method: 'PUT', body: jsonBody({ yaml }) }),
  remove: (name: string) => request<void>(`${base}/rgds/${enc(name)}`, { method: 'DELETE' }),
  retry: (name: string) => request<MessageResponse>(`${base}/rgds/${enc(name)}/retry`, { method: 'POST' }),
  /** Server-side dry run. Does not persist anything. */
  validate: (yaml: string, update: boolean) => request<K8sObject>(`${base}/rgds/validate${qs({ update })}`, { method: 'POST', body: jsonBody({ yaml }) }),
};

const instancePath = (definition: string, name?: string) =>
  `${base}/rgds/${enc(definition)}/instances${name ? `/${enc(name)}` : ''}`;

export const instancesApi = {
  list: (definition: string, opts: { namespace?: string; continueToken?: string | null }) =>
    request<InstancePage>(`${instancePath(definition)}${qs({ namespace: opts.namespace, continue: opts.continueToken })}`),
  /**
   * NEW (recommended) endpoint: GET /rgds/{definition}/instances/{name}?namespace=
   * The UI falls back to scanning list pages when the backend answers 404/405.
   */
  get: (definition: string, name: string, namespace?: string) =>
    request<K8sObject>(`${instancePath(definition, name)}${qs({ namespace })}`),
  /** `body` is the manifest serialised as JSON (valid YAML). */
  create: (definition: string, body: string, namespace?: string) =>
    request<K8sObject>(`${instancePath(definition)}${qs({ namespace })}`, { method: 'POST', body: jsonBody({ yaml: body }) }),
  update: (definition: string, name: string, body: string, namespace?: string) =>
    request<K8sObject>(`${instancePath(definition, name)}${qs({ namespace })}`, { method: 'PUT', body: jsonBody({ yaml: body }) }),
  remove: (definition: string, name: string, namespace?: string) =>
    request<void>(`${instancePath(definition, name)}${qs({ namespace })}`, { method: 'DELETE' }),
  resources: (definition: string, name: string, namespace?: string) =>
    request<InstanceResourcesResponse>(`${instancePath(definition, name)}/resources${qs({ namespace })}`),
  events: (definition: string, name: string, namespace?: string) =>
    request<EventsResponse>(`${instancePath(definition, name)}/events${qs({ namespace })}`),
  logs: (definition: string, name: string, resourceName: string, namespace?: string) =>
    request<ContainerLog[]>(`${instancePath(definition, name)}/resources/${enc(resourceName)}/logs${qs({ namespace })}`),
};

export const rbacApi = {
  report: (params: { definitionName?: string; namespace?: string; instanceName?: string }) =>
    request<RbacReport>(`${base}/rbac-advisor${qs(params)}`),
  plan: (definitionName: string, namespace?: string) =>
    request<RbacPlan>(`${base}/rbac-advisor/controller/${enc(definitionName)}/plan${qs({ namespace })}`),
  apply: (definitionName: string, payload: RbacApplyRequest) =>
    request<RbacApplyResult>(`${base}/rbac-advisor/controller/${enc(definitionName)}/apply`, { method: 'POST', body: jsonBody(payload) }),
};
