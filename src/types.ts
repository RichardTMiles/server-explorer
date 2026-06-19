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
