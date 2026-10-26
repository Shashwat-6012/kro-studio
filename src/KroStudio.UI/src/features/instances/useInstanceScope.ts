import { useDefinitions, useGeneratedApiFor } from '../../api/hooks';
import { useNamespace } from '../../app/NamespaceProvider';

/**
 * Resolves namespace scoping for a resource graph:
 * namespaced APIs get the selected namespace, cluster-scoped ones get none.
 */
export function useInstanceScope(definitionName: string | undefined, namespaceOverride?: string | null) {
  const { data: definitions } = useDefinitions();
  const { namespace: selected } = useNamespace();
  const definition = definitions?.find((item) => item.name === definitionName);
  const { api, isLoading } = useGeneratedApiFor(definition);
  const namespace = namespaceOverride ?? selected;
  return {
    definition,
    api,
    /** False until discovery tells us whether the generated API is namespaced. */
    ready: Boolean(definition) && !isLoading && Boolean(api),
    namespaced: api?.namespaced ?? false,
    /** Namespace to send to instance endpoints (undefined for cluster-scoped APIs). */
    namespace: api?.namespaced ? namespace || undefined : undefined,
    /** Namespace used for Kubernetes events, which are always namespaced. */
    eventNamespace: namespace || undefined,
  };
}
