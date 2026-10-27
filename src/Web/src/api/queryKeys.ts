export const keys = {
  connection: ['cluster', 'connection'] as const,
  capabilities: ['cluster', 'capabilities'] as const,
  kroInstallation: ['cluster', 'kro-installation'] as const,
  definitions: ['definitions'] as const,
  definition: (name: string) => ['definitions', name] as const,
  generatedApis: (signature: string) => ['generated-apis', signature] as const,
  instances: (definition: string, namespace: string | undefined, token: string | null) => ['instances', definition, namespace ?? null, token] as const,
  instance: (definition: string, name: string, namespace: string | undefined) => ['instance', definition, namespace ?? null, name] as const,
  instanceResources: (definition: string, name: string, namespace: string | undefined) => ['instance', definition, namespace ?? null, name, 'resources'] as const,
  instanceEvents: (definition: string, name: string, namespace: string | undefined) => ['instance', definition, namespace ?? null, name, 'events'] as const,
  resourceLogs: (definition: string, name: string, resource: string, namespace: string | undefined) => ['instance', definition, namespace ?? null, name, 'logs', resource] as const,
  rbacReport: (definitionName: string, namespace: string, instanceName: string) => ['rbac', definitionName, namespace, instanceName] as const,
};
