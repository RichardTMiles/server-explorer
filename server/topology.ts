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

const sampleTopology: Topology = topologySchema.parse({
  title: "Server Type-A Config & Connectivity",
  site: "Rack Lab",
  updatedAt: new Date("2026-06-19T13:30:00.000Z").toISOString(),
  rack: { label: "42U Server Rack", units: 42 },
  devices: [
    {
      id: "isp-1",
      label: "ISP 1",
      category: "external",
      status: "online",
      summary: "Primary WAN handoff",
      tags: ["uplink", "wan"],
    },
    {
      id: "isp-2",
      label: "ISP 2",
      category: "external",
      status: "online",
      summary: "Secondary WAN handoff",
      tags: ["uplink", "wan"],
    },
    {
      id: "edge-switch-a",
      label: "Edge Switch A",
      category: "network",
      status: "online",
      rackUnit: 41,
      rackHeight: 1,
      vendor: "Aruba / HP",
      model: "48-port access switch",
      role: "WAN and server access",
      ports: [
        { id: "uplink-a", label: "Uplink A", kind: "network", status: "online" },
        { id: "server-trunk", label: "Server trunk", kind: "network", status: "online" },
      ],
      metrics: [
        { label: "Ports up", value: "34 / 48", tone: "good" },
        { label: "Utilization", value: "18%", tone: "neutral" },
      ],
    },
    {
      id: "edge-switch-b",
      label: "Edge Switch B",
      category: "network",
      status: "online",
      rackUnit: 40,
      rackHeight: 1,
      vendor: "Aruba / HP",
      model: "48-port access switch",
      role: "Redundant access layer",
      ports: [
        { id: "uplink-b", label: "Uplink B", kind: "network", status: "online" },
        { id: "server-trunk", label: "Server trunk", kind: "network", status: "online" },
      ],
      metrics: [
        { label: "Ports up", value: "29 / 48", tone: "good" },
        { label: "Errors", value: "0", tone: "good" },
      ],
    },
    {
      id: "mgmt-switch",
      label: "Remote Management",
      category: "management",
      status: "degraded",
      rackUnit: 37,
      rackHeight: 1,
      model: "Out-of-band switch",
      role: "iDRAC, IPMI, serial adapters",
      summary: "One server reports no BMC heartbeat.",
      metrics: [
        { label: "BMC links", value: "7 / 8", tone: "warning" },
        { label: "VLAN", value: "10", tone: "neutral" },
      ],
    },
    {
      id: "firewall",
      label: "Firewall Pair",
      category: "network",
      status: "online",
      rackUnit: 34,
      rackHeight: 1,
      role: "WAN failover and internal routing",
      metrics: [
        { label: "WAN", value: "active/passive", tone: "good" },
        { label: "VPN", value: "3 tunnels", tone: "neutral" },
      ],
    },
    {
      id: "compute-01",
      label: "Compute 01",
      category: "compute",
      status: "online",
      rackUnit: 29,
      rackHeight: 2,
      vendor: "Dell",
      model: "PowerEdge R640",
      role: "Virtualization host",
      ip: "192.0.2.11",
      managementUrl: "https://example.invalid/idrac/compute-01",
      ports: [
        { id: "lan-a", label: "LAN A", kind: "network", status: "online" },
        { id: "mgmt", label: "iDRAC", kind: "management", status: "online" },
        { id: "storage", label: "Storage", kind: "storage", status: "online" },
      ],
      metrics: [
        { label: "CPU", value: "41%", tone: "neutral" },
        { label: "Memory", value: "62%", tone: "neutral" },
        { label: "Guests", value: "18", tone: "good" },
      ],
    },
    {
      id: "compute-02",
      label: "Compute 02",
      category: "compute",
      status: "online",
      rackUnit: 26,
      rackHeight: 2,
      vendor: "Dell",
      model: "PowerEdge R640",
      role: "Virtualization host",
      ports: [
        { id: "lan-a", label: "LAN A", kind: "network", status: "online" },
        { id: "mgmt", label: "iDRAC", kind: "management", status: "online" },
        { id: "storage", label: "Storage", kind: "storage", status: "online" },
      ],
      metrics: [
        { label: "CPU", value: "26%", tone: "good" },
        { label: "Memory", value: "55%", tone: "neutral" },
        { label: "Guests", value: "14", tone: "good" },
      ],
    },
    {
      id: "compute-03",
      label: "Compute 03",
      category: "compute",
      status: "degraded",
      rackUnit: 23,
      rackHeight: 2,
      vendor: "Dell",
      model: "PowerEdge R640",
      role: "Virtualization host",
      summary: "Management link warning.",
      ports: [
        { id: "lan-a", label: "LAN A", kind: "network", status: "online" },
        { id: "mgmt", label: "iDRAC", kind: "management", status: "offline" },
        { id: "storage", label: "Storage", kind: "storage", status: "online" },
      ],
      metrics: [
        { label: "CPU", value: "69%", tone: "warning" },
        { label: "Memory", value: "71%", tone: "warning" },
        { label: "Guests", value: "20", tone: "good" },
      ],
    },
    {
      id: "storage-01",
      label: "Storage 01",
      category: "storage",
      status: "online",
      rackUnit: 18,
      rackHeight: 4,
      model: "Disk shelf",
      role: "Shared VM storage",
      metrics: [
        { label: "Pool", value: "74%", tone: "warning" },
        { label: "Disks", value: "24 / 24", tone: "good" },
      ],
    },
    {
      id: "kvm",
      label: "KVM Console",
      category: "kvm",
      status: "online",
      rackUnit: 14,
      rackHeight: 1,
      role: "Crash cart and console access",
    },
    {
      id: "ups-a",
      label: "UPS A",
      category: "power",
      status: "online",
      rackUnit: 2,
      rackHeight: 3,
      role: "Protected power",
      metrics: [
        { label: "Load", value: "38%", tone: "good" },
        { label: "Runtime", value: "42m", tone: "good" },
      ],
    },
  ],
  links: [
    {
      id: "isp1-edge-a",
      kind: "network",
      status: "online",
      from: { deviceId: "isp-1" },
      to: { deviceId: "edge-switch-a", portId: "uplink-a" },
    },
    {
      id: "isp2-edge-b",
      kind: "network",
      status: "online",
      from: { deviceId: "isp-2" },
      to: { deviceId: "edge-switch-b", portId: "uplink-b" },
    },
    {
      id: "edge-firewall",
      kind: "network",
      status: "online",
      from: { deviceId: "edge-switch-a", portId: "server-trunk" },
      to: { deviceId: "firewall" },
    },
    {
      id: "mgmt-c01",
      kind: "management",
      status: "online",
      from: { deviceId: "mgmt-switch" },
      to: { deviceId: "compute-01", portId: "mgmt" },
    },
    {
      id: "mgmt-c02",
      kind: "management",
      status: "online",
      from: { deviceId: "mgmt-switch" },
      to: { deviceId: "compute-02", portId: "mgmt" },
    },
    {
      id: "mgmt-c03",
      kind: "management",
      status: "degraded",
      from: { deviceId: "mgmt-switch" },
      to: { deviceId: "compute-03", portId: "mgmt" },
    },
    {
      id: "storage-c01",
      kind: "storage",
      status: "online",
      from: { deviceId: "storage-01" },
      to: { deviceId: "compute-01", portId: "storage" },
    },
    {
      id: "storage-c02",
      kind: "storage",
      status: "online",
      from: { deviceId: "storage-01" },
      to: { deviceId: "compute-02", portId: "storage" },
    },
    {
      id: "kvm-c03",
      kind: "kvm",
      status: "online",
      from: { deviceId: "kvm" },
      to: { deviceId: "compute-03" },
    },
    {
      id: "ups-power",
      kind: "power",
      status: "online",
      from: { deviceId: "ups-a" },
      to: { deviceId: "compute-03" },
    },
  ],
  alerts: [
    {
      id: "mgmt-compute-03",
      severity: "warning",
      title: "Compute 03 management path degraded",
      detail: "The production topology file should replace this sample alert.",
      deviceId: "compute-03",
    },
  ],
});

export async function loadTopology(topologyFile?: string): Promise<Topology> {
  if (!topologyFile) {
    return { ...sampleTopology, updatedAt: new Date().toISOString() };
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
