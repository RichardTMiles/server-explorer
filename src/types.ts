export type DeviceStatus = "online" | "degraded" | "offline" | "unknown";
export type DeviceCategory =
  | "external"
  | "network"
  | "compute"
  | "storage"
  | "power"
  | "management"
  | "kvm"
  | "utility";
export type LinkKind = "network" | "management" | "storage" | "power" | "kvm" | "serial";

export type DeviceMetric = {
  label: string;
  value: string;
  tone: "neutral" | "good" | "warning" | "danger";
};

export type DevicePort = {
  id: string;
  label: string;
  kind: LinkKind;
  status: DeviceStatus;
};

export type DeviceProbe =
  | { kind: "http"; url: string }
  | { kind: "tcp"; host: string; port: number };

export type TopologyDevice = {
  id: string;
  label: string;
  category: DeviceCategory;
  status: DeviceStatus;
  rackUnit?: number;
  rackHeight: number;
  vendor?: string;
  model?: string;
  role?: string;
  summary?: string;
  ip?: string;
  managementUrl?: string;
  tags: string[];
  metrics: DeviceMetric[];
  ports: DevicePort[];
  probe?: DeviceProbe;
};

export type TopologyLink = {
  id: string;
  label?: string;
  kind: LinkKind;
  status: DeviceStatus;
  from: {
    deviceId: string;
    portId?: string;
  };
  to: {
    deviceId: string;
    portId?: string;
  };
};

export type TopologyAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: string;
  deviceId?: string;
};

export type Topology = {
  title: string;
  site: string;
  updatedAt?: string;
  rack: {
    label: string;
    units: number;
  };
  devices: TopologyDevice[];
  links: TopologyLink[];
  alerts: TopologyAlert[];
};

export type ProbeResult = {
  ok: boolean;
  kind: "http" | "tcp";
  target: string;
  elapsedMs: number;
  status?: number;
  error?: string;
};

export type ClusterMetricSet = {
  cpuUsagePct?: number;
  memoryUsagePct?: number;
  rootFsUsagePct?: number;
  diskBusyPct?: number;
};

export type ClusterLonghornDisk = {
  id: string;
  node?: string;
  path?: string;
  allowScheduling: boolean;
  ready: boolean;
  schedulable: boolean;
  storageMaximumBytes?: number;
  storageAvailableBytes?: number;
  scheduledReplicaBytes: number;
  usedPct?: number;
  scheduledPct?: number;
  conditions: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
};

export type ClusterNode = {
  name: string;
  status: string;
  roles: string[];
  internalIp?: string;
  osImage?: string;
  kernelVersion?: string;
  kubeletVersion?: string;
  ageMs?: number;
  metrics: ClusterMetricSet;
  longhorn?: {
    allowScheduling: boolean;
    disks: ClusterLonghornDisk[];
  };
};

export type ClusterPod = {
  namespace: string;
  name: string;
  phase: string;
  nodeName?: string;
  podIp?: string;
  ready: number;
  total: number;
  restarts: number;
  owner?: string;
  ageMs?: number;
};

export type ClusterService = {
  namespace: string;
  name: string;
  type: string;
  clusterIp?: string;
  externalIps: unknown[];
  ports: Array<{
    name?: string;
    port?: number;
    protocol?: string;
    nodePort?: number;
  }>;
  ageMs?: number;
};

export type ClusterWorkload = {
  kind: string;
  namespace: string;
  name: string;
  desired?: number;
  ready?: number;
  available?: number;
  ageMs?: number;
};

export type ClusterVirtualMachine = {
  namespace: string;
  name: string;
  running: boolean;
  printableStatus: string;
  nodeName?: string;
  ip?: string;
  cpu?: unknown;
  memory?: unknown;
  volumes: unknown[];
  ageMs?: number;
};

export type ClusterLonghornVolume = {
  namespace: string;
  name: string;
  state?: string;
  robustness?: string;
  nodeId?: string;
  sizeBytes?: number;
  actualSizeBytes?: number;
  frontend?: string;
  numberOfReplicas?: number;
  ageMs?: number;
};

export type ClusterOverview = {
  updatedAt: string;
  source: {
    kubernetes: string;
    grafanaUrl: string;
    prometheusUrl: string;
    metrics: string;
  };
  warnings: string[];
  summary: {
    namespaces: number;
    nodes: number;
    pods: number;
    runningPods: number;
    services: number;
    workloads: number;
    virtualMachines: number;
    runningVirtualMachines: number;
    persistentVolumes: number;
    persistentVolumeClaims: number;
    storageClasses: number;
    longhornVolumes: number;
    healthyLonghornVolumes: number;
    longhornReplicas: number;
    longhornEngines: number;
    longhornDisks: number;
    readyLonghornDisks: number;
  };
  nodes: ClusterNode[];
  pods: ClusterPod[];
  services: ClusterService[];
  workloads: ClusterWorkload[];
  virtualMachines: ClusterVirtualMachine[];
  storage: {
    persistentVolumes: Array<Record<string, unknown>>;
    persistentVolumeClaims: Array<Record<string, unknown>>;
    storageClasses: Array<Record<string, unknown>>;
    longhorn: {
      nodes: Array<{
        name: string;
        allowScheduling: boolean;
        disks: ClusterLonghornDisk[];
      }>;
      disks: ClusterLonghornDisk[];
      volumes: ClusterLonghornVolume[];
    };
  };
  totals: {
    longhornStorageMaximumGiB?: number;
    longhornStorageAvailableGiB?: number;
    longhornScheduledReplicaGiB?: number;
  };
};
