import type { GeneratedApi, K8sObject } from '../api/types';

export const starterYaml = `apiVersion: kro.run/v1alpha1
kind: ResourceGraphDefinition
metadata:
  name: web-application
spec:
  schema:
    apiVersion: v1alpha1
    kind: WebApplication
    spec:
      name: string
      image: string
      replicas: integer | default=2
  resources:
    - id: deployment
      template:
        apiVersion: apps/v1
        kind: Deployment
        metadata:
          name: \${schema.spec.name}
        spec:
          replicas: \${schema.spec.replicas}
          selector:
            matchLabels:
              app: \${schema.spec.name}
          template:
            metadata:
              labels:
                app: \${schema.spec.name}
            spec:
              containers:
                - name: app
                  image: \${schema.spec.image}
`;

export function instanceTemplate(api: GeneratedApi, namespace: string): K8sObject {
  return {
    apiVersion: `${api.group}/${api.version}`,
    kind: api.kind,
    metadata: { name: '', ...(api.namespaced ? { namespace } : {}) },
    spec: {},
  };
}
