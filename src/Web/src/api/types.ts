/** API contracts shared between the UI and the KRO Studio backend (/api/v1). */

export type OwnerReference = { uid: string; kind?: string; name?: string };
export type ObjectMeta = {
  name?: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: OwnerReference[];
};
export type Condition = { type?: string; status?: string; reason?: string; message?: string; lastTransitionTime?: string };

/** Loose shape of any Kubernetes object returned by the cluster. */
export type K8sObject = {
  apiVersion?: string;
  kind?: string;
  metadata?: ObjectMeta;
  spec?: Record<string, any>;
  status?: Record<string, any>;
  [key: string]: any;
};

// ---- Cluster ---------------------------------------------------------------
export type Connection = { connected: boolean; context: string | null; kubernetesVersion: string | null; message: string };
export type Capability = { clusterApiAvailable: boolean; kroApiAvailable: boolean; message: string };
export type KroInstallation = { version: string; documentationUrl: string };
export type InstallationResult = { alreadyInstalled: boolean; version: string; resourcesApplied: number; message: string };
export type MessageResponse = { message: string };

// ---- Resource graph definitions -------------------------------------------
export type Definition = {
  name: string;
  kind: string;
  apiVersion: string;
  generatedKind: string | null;
  readiness: string;
  createdAt: string | null;
};
export type GeneratedApi = {
  id: string;
  group: string;
  version: string;
  plural: string;
  kind: string;
  namespaced: boolean;
  schema: Record<string, any> | null;
  /** Added client-side: which definition produced this API. */
  definitionName?: string;
};

// ---- Instances -------------------------------------------------------------
export type InstancePage = { items: K8sObject[]; continue: string | null };
export type ComposedResource = { resourceId: string; parentResourceName?: string | null; object: K8sObject };
export type InstanceResourcesResponse = { resources: ComposedResource[]; warnings: string[] };
export type EventsResponse = { items: K8sObject[] };
export type ContainerLog = { podName: string; container: string; text: string };

// ---- RBAC advisor ----------------------------------------------------------
export type FindingStatus = 'allowed' | 'denied' | 'unknown' | 'observed failure' | 'observed issue';
export type RbacFinding = {
  identity: string;
  check: string;
  status: FindingStatus;
  verb: string;
  apiGroup: string;
  resource: string;
  namespace: string | null;
  detail: string;
  source: string;
};
export type RbacReport = { studioIdentity: string; controllerIdentity: string; checkedAt: string; studio: RbacFinding[]; controller: RbacFinding[]; note: string };
export type RbacRequirement = { label: string; verb: string; apiGroup: string; resource: string; namespace: string | null };
export type RbacPlannedObject = {
  kind: string;
  name: string;
  manifest: K8sObject;
  exists: boolean;
  managedByStudio: boolean;
  matchesPlan: boolean;
  inspectable: boolean;
  canUpdate: boolean;
};
export type RbacPlan = {
  definitionName: string;
  controllerIdentity: string;
  serviceAccountVerified: boolean;
  planToken: string;
  requirements: RbacRequirement[];
  clusterRole: RbacPlannedObject;
  clusterRoleBinding: RbacPlannedObject;
  impact: string;
};
export type RbacApplyRequest = { confirmed: true; namespace: string | null; planToken: string };
export type RbacApplyResult = { created: string[]; message: string };
