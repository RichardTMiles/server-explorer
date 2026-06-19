import fs from "node:fs/promises";
import { z } from "zod";

const statusSchema = z.enum(["online", "degraded", "offline", "unknown"]);
const categorySchema = z.enum([
  "external",
  "network",
  "compute",
  "storage",
  "power",
  "management",
  "kvm",
  "utility",
]);
const linkKindSchema = z.enum([
  "network",
  "management",
  "storage",
  "power",
  "kvm",
  "serial",
]);

const endpointSchema = z.object({
  deviceId: z.string().min(1),
  portId: z.string().min(1).optional(),
});

const probeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("http"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("tcp"),
    host: z.string().min(1),
    port: z.number().int().positive().max(65535),
  }),
]);

const deviceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: categorySchema,
  status: statusSchema.default("unknown"),
  rackUnit: z.number().int().positive().optional(),
  rackHeight: z.number().int().positive().default(1),
  vendor: z.string().optional(),
  model: z.string().optional(),
  role: z.string().optional(),
  summary: z.string().optional(),
  ip: z.string().optional(),
  managementUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  metrics: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        tone: z.enum(["neutral", "good", "warning", "danger"]).default("neutral"),
      })
    )
    .default([]),
  ports: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        kind: linkKindSchema,
        status: statusSchema.default("unknown"),
      })
    )
    .default([]),
  probe: probeSchema.optional(),
});

const topologySchema = z.object({
  title: z.string().min(1).default("Server Explorer"),
  site: z.string().min(1).default("Infrastructure"),
  updatedAt: z.string().datetime().optional(),
  rack: z.object({
    label: z.string().min(1).default("42U Server Rack"),
    units: z.number().int().positive().max(60).default(42),
  }),
  devices: z.array(deviceSchema).default([]),
  links: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().optional(),
        kind: linkKindSchema,
        status: statusSchema.default("unknown"),
        from: endpointSchema,
        to: endpointSchema,
      })
    )
    .default([]),
  alerts: z
    .array(
      z.object({
        id: z.string().min(1),
        severity: z.enum(["info", "warning", "critical"]),
        title: z.string().min(1),
        detail: z.string().min(1).optional(),
        deviceId: z.string().optional(),
      })
    )
    .default([]),
});

export type Topology = z.infer<typeof topologySchema>;
export type TopologyDevice = Topology["devices"][number];

const currentRackTopology: Topology = topologySchema.parse({
  title: "Miles Rack Server Explorer",
  site: "Harvester rack",
  updatedAt: new Date("2026-06-19T15:15:00.000Z").toISOString(),
  rack: { label: "One switch / four server rack", units: 42 },
  devices: [
    {
      id: "procurve-2810",
      label: "ProCurve 2810-24G",
      category: "network",
      status: "online",
      rackUnit: 41,
      rackHeight: 1,
      vendor: "HP",
      model: "J9021A Switch 2810-24G",
      role: "Only access switch in this rack",
      ip: "192.168.1.193",
      managementUrl: "https://procurve.miles.systems",
      summary:
        "Live ProCurve SNMP view reported 9/24 ports up, one VLAN, and no LLDP neighbors. Server mappings are from ARP plus the switch MAC table.",
      probe: { kind: "http", url: "http://192.168.1.193" },
      tags: ["switch", "snmp", "procurve"],
      metrics: [
        { label: "Ports up", value: "9 / 24", tone: "good" },
        { label: "Mapped servers", value: "3 / 4", tone: "warning" },
        { label: "VLANs", value: "1", tone: "neutral" },
        { label: "LLDP neighbors", value: "0", tone: "neutral" },
      ],
      ports: [
        { id: "port-1", label: "Port 1 / upstream LAN / 12 learned MACs", kind: "network", status: "online" },
        { id: "port-3", label: "Port 3 / active / no learned MAC", kind: "network", status: "unknown" },
        { id: "port-6", label: "Port 6 / active 100M / no learned MAC", kind: "network", status: "unknown" },
        { id: "port-11", label: "Port 11 / active / no learned MAC", kind: "network", status: "unknown" },
        { id: "port-19", label: "Port 19 / r640 / 24:6e:96:c7:d2:16", kind: "network", status: "online" },
        { id: "port-21", label: "Port 21 / active / no learned MAC", kind: "network", status: "unknown" },
        { id: "port-22", label: "Port 22 / r510b / 78:2b:cb:2d:bb:a1", kind: "network", status: "online" },
        { id: "port-23", label: "Port 23 / r710 / d4:ae:52:73:e8:af", kind: "network", status: "online" },
        { id: "port-24", label: "Port 24 / active 100M / no learned MAC", kind: "network", status: "unknown" },
        { id: "r510a-unlearned", label: "r510a switch port not learned", kind: "network", status: "offline" },
      ],
    },
    {
      id: "r640",
      label: "r640",
      category: "compute",
      status: "online",
      rackUnit: 34,
      rackHeight: 1,
      vendor: "Dell",
      model: "PowerEdge R640",
      role: "Harvester control-plane node / performance node",
      ip: "192.168.1.100",
      summary: "Kubernetes node is Ready. ARP MAC 24:6e:96:c7:d2:16 is learned on ProCurve port 19.",
      probe: { kind: "tcp", host: "192.168.1.100", port: 22 },
      tags: ["harvester", "control-plane", "ready"],
      ports: [
        { id: "lan", label: "LAN / 192.168.1.100 / switch port 19", kind: "network", status: "online" },
      ],
      metrics: [
        { label: "Node", value: "Ready", tone: "good" },
        { label: "Switch port", value: "19", tone: "good" },
        { label: "MAC", value: "24:6e:96:c7:d2:16", tone: "neutral" },
      ],
    },
    {
      id: "r510b",
      label: "r510b",
      category: "compute",
      status: "online",
      rackUnit: 30,
      rackHeight: 2,
      vendor: "Dell",
      model: "PowerEdge R510",
      role: "Harvester control-plane node",
      ip: "192.168.1.102",
      summary: "Kubernetes node is Ready. ARP MAC 78:2b:cb:2d:bb:a1 is learned on ProCurve port 22.",
      probe: { kind: "tcp", host: "192.168.1.102", port: 22 },
      tags: ["harvester", "control-plane", "ready"],
      ports: [
        { id: "lan", label: "LAN / 192.168.1.102 / switch port 22", kind: "network", status: "online" },
      ],
      metrics: [
        { label: "Node", value: "Ready", tone: "good" },
        { label: "Switch port", value: "22", tone: "good" },
        { label: "MAC", value: "78:2b:cb:2d:bb:a1", tone: "neutral" },
      ],
    },
    {
      id: "r510a",
      label: "r510a",
      category: "compute",
      status: "offline",
      rackUnit: 26,
      rackHeight: 2,
      vendor: "Dell",
      model: "PowerEdge R510",
      role: "Harvester control-plane node",
      ip: "192.168.1.101",
      summary:
        "Kubernetes reports NodeStatusUnknown and SSH/ping checks did not complete. Local ARP had fe:07:c6:32:b3:ac, but the ProCurve MAC table did not learn that MAC on any port.",
      probe: { kind: "tcp", host: "192.168.1.101", port: 22 },
      tags: ["harvester", "control-plane", "not-ready"],
      ports: [
        { id: "lan", label: "LAN / 192.168.1.101 / switch port not learned", kind: "network", status: "offline" },
      ],
      metrics: [
        { label: "Node", value: "NotReady", tone: "danger" },
        { label: "Switch port", value: "not learned", tone: "warning" },
        { label: "Last ARP", value: "fe:07:c6:32:b3:ac", tone: "neutral" },
      ],
    },
    {
      id: "r710",
      label: "r710",
      category: "compute",
      status: "online",
      rackUnit: 21,
      rackHeight: 2,
      vendor: "Dell",
      model: "PowerEdge R710",
      role: "Harvester worker node",
      ip: "192.168.1.103",
      summary: "Kubernetes node is Ready. ARP MAC d4:ae:52:73:e8:af is learned on ProCurve port 23.",
      probe: { kind: "tcp", host: "192.168.1.103", port: 22 },
      tags: ["harvester", "worker", "ready"],
      ports: [
        { id: "lan", label: "LAN / 192.168.1.103 / switch port 23", kind: "network", status: "online" },
      ],
      metrics: [
        { label: "Node", value: "Ready", tone: "good" },
        { label: "Switch port", value: "23", tone: "good" },
        { label: "MAC", value: "d4:ae:52:73:e8:af", tone: "neutral" },
      ],
    },
  ],
  links: [
    {
      id: "switch-r640",
      kind: "network",
      status: "online",
      from: { deviceId: "procurve-2810", portId: "port-19" },
      to: { deviceId: "r640", portId: "lan" },
    },
    {
      id: "switch-r510b",
      kind: "network",
      status: "online",
      from: { deviceId: "procurve-2810", portId: "port-22" },
      to: { deviceId: "r510b", portId: "lan" },
    },
    {
      id: "switch-r510a",
      kind: "network",
      status: "offline",
      from: { deviceId: "procurve-2810", portId: "r510a-unlearned" },
      to: { deviceId: "r510a", portId: "lan" },
    },
    {
      id: "switch-r710",
      kind: "network",
      status: "online",
      from: { deviceId: "procurve-2810", portId: "port-23" },
      to: { deviceId: "r710", portId: "lan" },
    },
  ],
  alerts: [
    {
      id: "r510a-not-ready",
      severity: "warning",
      title: "r510a is not currently reachable",
      detail: "Cluster Ready condition is Unknown and the switch has no learned MAC for the last observed ARP address.",
      deviceId: "r510a",
    },
  ],
});

export async function loadTopology(topologyFile?: string): Promise<Topology> {
  if (!topologyFile) {
    return { ...currentRackTopology, updatedAt: new Date().toISOString() };
  }

  const raw = await fs.readFile(topologyFile, "utf8");
  const parsed = topologySchema.parse(JSON.parse(raw));
  return {
    ...parsed,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
  };
}

export function findDevice(topology: Topology, deviceId: string): TopologyDevice | undefined {
  return topology.devices.find((device) => device.id === deviceId);
}
