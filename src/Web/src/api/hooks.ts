import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, messageOf } from './client';
import { clusterApi, definitionsApi, instancesApi, rbacApi } from './endpoints';
import { keys } from './queryKeys';
import type { Connection, Definition, GeneratedApi, K8sObject, RbacApplyRequest } from './types';
import { useToast } from '../components/Toast';
import { objectName } from '../lib/k8s';

const LIVE_INTERVAL = 5_000;
const NO_API: Connection = { connected: false, context: null, kubernetesVersion: null, message: 'The local API is not available. Start the API to connect to your cluster.' };

// ---- Cluster ---------------------------------------------------------------
export function useConnection() {
  return useQuery({
    queryKey: keys.connection,
    queryFn: async () => { try { return await clusterApi.connection(); } catch { return NO_API; } },
    refetchInterval: 15_000,
  });
}

export function useCluster() {
  const connection = useConnection();
  const capabilities = useQuery({ queryKey: keys.capabilities, queryFn: clusterApi.capabilities, refetchInterval: 15_000 });
  const installation = useQuery({ queryKey: keys.kroInstallation, queryFn: clusterApi.kroInstallation });
  const connected = connection.data?.connected ?? false;
  return {
    connection: connection.data,
    capabilities: capabilities.data,
    installation: installation.data,
    connected,
    kroReady: connected && (capabilities.data?.kroApiAvailable ?? false),
    loading: connection.isPending,
  };
}

export function useInstallKro() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: clusterApi.installKro,
    onSuccess: (result) => { toast.success(result.message); void queryClient.invalidateQueries(); },
    onError: (error) => toast.error(messageOf(error)),
  });
}

export function useRestartKro() {
  const toast = useToast();
  return useMutation({
    mutationFn: clusterApi.restartController,
    onSuccess: (result) => toast.success(result.message),
    onError: (error) => toast.error(messageOf(error)),
  });
}

// ---- Definitions -----------------------------------------------------------
export function useDefinitions() {
  const { kroReady } = useCluster();
  return useQuery({
    queryKey: keys.definitions,
    queryFn: definitionsApi.list,
    enabled: kroReady,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
}

export function useDefinitionManifest(name: string | undefined) {
  return useQuery({ queryKey: keys.definition(name ?? ''), queryFn: () => definitionsApi.get(name!), enabled: Boolean(name), refetchInterval: 10_000 });
}

const NO_APIS: GeneratedApi[] = [];

/** Generated custom APIs, one per resource graph definition that has been reconciled. */
export function useApiCatalog() {
  const { data: definitions } = useDefinitions();
  const names = (definitions ?? []).map((item) => `${item.name}:${item.generatedKind ?? ''}`);
  const query = useQuery({
    queryKey: keys.generatedApis(names.join('|')),
    enabled: names.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const list = definitions ?? [];
      const results = await Promise.allSettled(list.map((item) => definitionsApi.generatedApi(item.name)));
      return results.flatMap((result, index): GeneratedApi[] => result.status === 'fulfilled' ? [{ ...result.value, definitionName: list[index].name }] : []);
    },
  });
  return { apis: query.data ?? NO_APIS, isLoading: query.isPending && names.length > 0 };
}

export function useGeneratedApiFor(definition: Definition | undefined) {
  const { apis, isLoading } = useApiCatalog();
  const api = definition ? apis.find((entry) => entry.definitionName === definition.name) ?? apis.find((entry) => entry.kind === definition.generatedKind) : undefined;
  return { api, isLoading };
}

export function useSaveDefinition() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ mode, name, yaml }: { mode: 'create' | 'edit'; name?: string; yaml: string }) =>
      mode === 'create' ? definitionsApi.create(yaml) : definitionsApi.update(name!, yaml),
    onSuccess: (_result, variables) => {
      toast.success(variables.mode === 'create' ? 'Resource graph created.' : 'Resource graph updated.');
      void queryClient.invalidateQueries({ queryKey: keys.definitions });
    },
  });
}

export function useValidateDefinition() {
  return useMutation({ mutationFn: ({ yaml, update }: { yaml: string; update: boolean }) => definitionsApi.validate(yaml, update) });
}

export function useDeleteDefinition() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (name: string) => definitionsApi.remove(name),
    onSuccess: (_result, name) => { toast.success(`Deleted ${name}.`); void queryClient.invalidateQueries({ queryKey: keys.definitions }); },
    onError: (error) => toast.error(messageOf(error)),
  });
}

export function useRetryDefinition() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (name: string) => definitionsApi.retry(name),
    onSuccess: (result) => { toast.success(result.message); void queryClient.invalidateQueries({ queryKey: keys.definitions }); },
    onError: (error) => toast.error(messageOf(error)),
  });
}

// ---- Instances -------------------------------------------------------------
export function useInstances(definition: string | undefined, namespace: string | undefined, token: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.instances(definition ?? '', namespace, token),
    queryFn: () => instancesApi.list(definition!, { namespace, continueToken: token }),
    enabled: Boolean(definition) && enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 8_000,
  });
}

async function fetchInstance(definition: string, name: string, namespace?: string): Promise<K8sObject> {
  try {
    return await instancesApi.get(definition, name, namespace);
  } catch (error) {
    if (!(error instanceof ApiError) || ![404, 405].includes(error.status)) throw error;
  }
  // Fallback while the backend has no single-instance endpoint: scan the first list pages.
  let token: string | null = null;
  for (let page = 0; page < 5; page++) {
    const result = await instancesApi.list(definition, { namespace, continueToken: token });
    const hit = result.items.find((item) => objectName(item) === name);
    if (hit) return hit;
    if (!result.continue) break;
    token = result.continue;
  }
  throw new ApiError(`Instance “${name}” was not found.`, 404);
}

export function useInstance(definition: string, name: string, namespace: string | undefined, live: boolean, enabled: boolean) {
  return useQuery({
    queryKey: keys.instance(definition, name, namespace),
    queryFn: () => fetchInstance(definition, name, namespace),
    enabled,
    retry: false,
    refetchInterval: live ? LIVE_INTERVAL : false,
  });
}

export function useInstanceResources(definition: string, name: string, namespace: string | undefined, live: boolean, enabled: boolean) {
  return useQuery({
    queryKey: keys.instanceResources(definition, name, namespace),
    queryFn: () => instancesApi.resources(definition, name, namespace),
    enabled,
    retry: false,
    refetchInterval: live ? LIVE_INTERVAL : false,
  });
}

export function useInstanceEvents(definition: string, name: string, namespace: string | undefined, live: boolean, enabled: boolean) {
  return useQuery({
    queryKey: keys.instanceEvents(definition, name, namespace),
    queryFn: () => instancesApi.events(definition, name, namespace),
    enabled,
    refetchInterval: live ? LIVE_INTERVAL * 2 : false,
  });
}

export function useResourceLogs(definition: string, instance: string, resource: string, namespace: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.resourceLogs(definition, instance, resource, namespace),
    queryFn: () => instancesApi.logs(definition, instance, resource, namespace),
    enabled,
    retry: false,
    staleTime: 0,
  });
}

export function useSaveInstance() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ definition, mode, name, namespace, body }: { definition: string; mode: 'create' | 'edit'; name?: string; namespace?: string; body: string }) =>
      mode === 'create' ? instancesApi.create(definition, body, namespace) : instancesApi.update(definition, name!, body, namespace),
    onSuccess: (_result, variables) => {
      toast.success(variables.mode === 'create' ? 'Instance created.' : 'Instance updated.');
      void queryClient.invalidateQueries({ queryKey: ['instances', variables.definition] });
      void queryClient.invalidateQueries({ queryKey: ['instance', variables.definition] });
    },
  });
}

export function useDeleteInstance() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ definition, name, namespace }: { definition: string; name: string; namespace?: string }) => instancesApi.remove(definition, name, namespace),
    onSuccess: (_result, variables) => {
      toast.success(`Deleted ${variables.name}.`);
      void queryClient.invalidateQueries({ queryKey: ['instances', variables.definition] });
    },
    onError: (error) => toast.error(messageOf(error)),
  });
}

// ---- RBAC advisor ----------------------------------------------------------
export function useRbacReport(params: { definitionName: string; namespace: string; instanceName: string }) {
  return useQuery({
    queryKey: keys.rbacReport(params.definitionName, params.namespace, params.instanceName),
    queryFn: () => rbacApi.report({ definitionName: params.definitionName, namespace: params.namespace, instanceName: params.instanceName.trim() }),
    enabled: Boolean(params.definitionName),
    retry: false,
  });
}

export function useRbacPlan() {
  return useMutation({ mutationFn: ({ definitionName, namespace }: { definitionName: string; namespace?: string }) => rbacApi.plan(definitionName, namespace) });
}

export function useApplyRbac() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ definitionName, payload }: { definitionName: string; payload: RbacApplyRequest }) => rbacApi.apply(definitionName, payload),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['rbac'] }); },
  });
}
