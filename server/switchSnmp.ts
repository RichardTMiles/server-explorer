import * as snmp from "net-snmp";
import type { ServiceConfig, SwitchMacEntry, SwitchNeighbor, SwitchPort, SystemInfo, VlanInfo } from "./switchTypes.js";

const SYSTEM_OIDS = {
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysObjectId: "1.3.6.1.2.1.1.2.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysContact: "1.3.6.1.2.1.1.4.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  sysLocation: "1.3.6.1.2.1.1.6.0"
};

const IF_OIDS = {
  descr: "1.3.6.1.2.1.2.2.1.2",
  physAddress: "1.3.6.1.2.1.2.2.1.6",
  speed: "1.3.6.1.2.1.2.2.1.5",
  adminStatus: "1.3.6.1.2.1.2.2.1.7",
  operStatus: "1.3.6.1.2.1.2.2.1.8",
  inOctets: "1.3.6.1.2.1.2.2.1.10",
  inDiscards: "1.3.6.1.2.1.2.2.1.13",
  inErrors: "1.3.6.1.2.1.2.2.1.14",
  outOctets: "1.3.6.1.2.1.2.2.1.16",
  outDiscards: "1.3.6.1.2.1.2.2.1.19",
  outErrors: "1.3.6.1.2.1.2.2.1.20",
  alias: "1.3.6.1.2.1.31.1.1.1.18"
};

const VLAN_NAME_OID = "1.3.6.1.2.1.17.7.1.4.3.1.1";
const VLAN_EGRESS_PORTS_OID = "1.3.6.1.2.1.17.7.1.4.3.1.2";
const VLAN_UNTAGGED_PORTS_OID = "1.3.6.1.2.1.17.7.1.4.3.1.4";
const VLAN_STATUS_OID = "1.3.6.1.2.1.17.7.1.4.3.1.5";

const LLDP_OIDS = {
  chassisId: "1.0.8802.1.1.2.1.4.1.1.5",
  portId: "1.0.8802.1.1.2.1.4.1.1.7",
  portDescription: "1.0.8802.1.1.2.1.4.1.1.8",
  systemName: "1.0.8802.1.1.2.1.4.1.1.9",
  systemDescription: "1.0.8802.1.1.2.1.4.1.1.10"
};

const BRIDGE_OIDS = {
  basePortIfIndex: "1.3.6.1.2.1.17.1.4.1.2",
  fdbAddress: "1.3.6.1.2.1.17.4.3.1.1",
  fdbPort: "1.3.6.1.2.1.17.4.3.1.2",
  fdbStatus: "1.3.6.1.2.1.17.4.3.1.3"
};

type Varbind = {
  oid: string;
  value: snmp.VarbindValue;
};

function createSession(config: ServiceConfig) {
  if (!config.snmpCommunity) {
    return undefined;
  }

  return snmp.createSession(config.switchHost, config.snmpCommunity, {
    version: snmp.Version2c,
    timeout: 1500,
    retries: 1
  });
}

function valueToString(value: unknown) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").replace(/\0/g, "").trim();
  }

  return String(value ?? "").trim();
}

function valueToNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  const parsed = Number(valueToString(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function valueToMac(value: unknown) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    return undefined;
  }

  return [...value].map((part) => part.toString(16).padStart(2, "0")).join(":");
}

function statusFromNumber(value: unknown): SwitchPort["operStatus"] {
  switch (valueToNumber(value)) {
    case 1:
      return "up";
    case 2:
      return "down";
    case 3:
      return "testing";
    default:
      return "unknown";
  }
}

function formatUptime(ticks: number | undefined) {
  if (ticks == null) {
    return undefined;
  }

  const totalSeconds = Math.floor(ticks / 100);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

function getOne(session: snmp.Session, oid: string): Promise<snmp.VarbindValue | undefined> {
  return new Promise((resolve) => {
    session.get([oid], (error, varbinds) => {
      if (error || !varbinds?.[0] || snmp.isVarbindError(varbinds[0])) {
        resolve(undefined);
        return;
      }

      resolve(varbinds[0].value);
    });
  });
}

function walk(session: snmp.Session, oid: string): Promise<Varbind[]> {
  return new Promise((resolve) => {
    const rows: Varbind[] = [];

    session.subtree(
      oid,
      (varbinds) => {
        for (const varbind of varbinds) {
          if (!snmp.isVarbindError(varbind)) {
            rows.push({ oid: varbind.oid, value: varbind.value });
          }
        }
      },
      () => resolve(rows)
    );
  });
}

function indexFromOid(oid: string, baseOid: string) {
  const suffix = oid.startsWith(`${baseOid}.`) ? oid.slice(baseOid.length + 1) : "";
  const parsed = Number(suffix.split(".").at(-1));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapByIndex(rows: Varbind[], baseOid: string) {
  const map = new Map<number, unknown>();

  for (const row of rows) {
    const index = indexFromOid(row.oid, baseOid);
    if (index != null) {
      map.set(index, row.value);
    }
  }

  return map;
}

function decodePortBitmap(value: unknown) {
  if (!Buffer.isBuffer(value)) {
    return [];
  }

  const ports: number[] = [];
  for (let byteIndex = 0; byteIndex < value.length; byteIndex += 1) {
    const byte = value[byteIndex] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((byte & (1 << (7 - bit))) !== 0) {
        ports.push(byteIndex * 8 + bit + 1);
      }
    }
  }

  return ports;
}

function lldpKeyFromOid(oid: string, baseOid: string) {
  return oid.startsWith(`${baseOid}.`) ? oid.slice(baseOid.length + 1) : undefined;
}

function lldpLocalPortFromKey(key: string) {
  const parts = key.split(".").map(Number);
  return Number.isFinite(parts[1]) ? parts[1] : undefined;
}

function suffixFromOid(oid: string, baseOid: string) {
  return oid.startsWith(`${baseOid}.`) ? oid.slice(baseOid.length + 1) : undefined;
}

function mapBySuffix(rows: Varbind[], baseOid: string) {
  const map = new Map<string, unknown>();

  for (const row of rows) {
    const suffix = suffixFromOid(row.oid, baseOid);
    if (suffix) {
      map.set(suffix, row.value);
    }
  }

  return map;
}

function macFromOidSuffix(suffix: string | undefined) {
  if (!suffix) {
    return undefined;
  }

  const octets = suffix.split(".").map(Number);
  if (octets.length !== 6 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }

  return octets.map((octet) => octet.toString(16).padStart(2, "0")).join(":");
}

function fdbStatus(value: number | undefined) {
  switch (value) {
    case 1:
      return "other";
    case 2:
      return "invalid";
    case 3:
      return "learned";
    case 4:
      return "self";
    case 5:
      return "management";
    default:
      return undefined;
  }
}

function maxSpeedMbpsForPort(config: ServiceConfig, index: number, name: string, speedMbps: number | undefined) {
  const modelHint = `${config.switchLabel}`.toLowerCase();
  if (modelHint.includes("2810-24g") && index >= 1 && index <= 24 && /^\d+$/.test(name)) {
    return 1000;
  }

  return speedMbps;
}

export async function getSystemInfo(config: ServiceConfig): Promise<Partial<SystemInfo>> {
  const session = createSession(config);
  if (!session) {
    return { snmpEnabled: false };
  }

  try {
    const [sysDescr, sysObjectId, uptimeTicksRaw, contact, sysName, location] = await Promise.all([
      getOne(session, SYSTEM_OIDS.sysDescr),
      getOne(session, SYSTEM_OIDS.sysObjectId),
      getOne(session, SYSTEM_OIDS.sysUpTime),
      getOne(session, SYSTEM_OIDS.sysContact),
      getOne(session, SYSTEM_OIDS.sysName),
      getOne(session, SYSTEM_OIDS.sysLocation)
    ]);
    const uptimeTicks = valueToNumber(uptimeTicksRaw);
    const hasSnmpData = Boolean(sysDescr || sysObjectId || uptimeTicksRaw || contact || sysName || location);

    return {
      snmpEnabled: hasSnmpData,
      sysDescr: sysDescr ? valueToString(sysDescr) : undefined,
      sysObjectId: sysObjectId ? valueToString(sysObjectId) : undefined,
      uptimeTicks,
      uptimeText: formatUptime(uptimeTicks),
      contact: contact ? valueToString(contact) : undefined,
      sysName: sysName ? valueToString(sysName) : undefined,
      location: location ? valueToString(location) : undefined
    };
  } finally {
    session.close();
  }
}

export async function getPorts(config: ServiceConfig): Promise<SwitchPort[]> {
  const session = createSession(config);
  if (!session) {
    return fallbackPorts();
  }

  try {
    const descrRows = await walk(session, IF_OIDS.descr);
    const aliasRows = await walk(session, IF_OIDS.alias);
    const physRows = await walk(session, IF_OIDS.physAddress);
    const speedRows = await walk(session, IF_OIDS.speed);
    const adminRows = await walk(session, IF_OIDS.adminStatus);
    const operRows = await walk(session, IF_OIDS.operStatus);
    const inRows = await walk(session, IF_OIDS.inOctets);
    const outRows = await walk(session, IF_OIDS.outOctets);
    const inErrorRows = await walk(session, IF_OIDS.inErrors);
    const outErrorRows = await walk(session, IF_OIDS.outErrors);
    const inDiscardRows = await walk(session, IF_OIDS.inDiscards);
    const outDiscardRows = await walk(session, IF_OIDS.outDiscards);

    const descr = mapByIndex(descrRows, IF_OIDS.descr);
    const alias = mapByIndex(aliasRows, IF_OIDS.alias);
    const physAddress = mapByIndex(physRows, IF_OIDS.physAddress);
    const speed = mapByIndex(speedRows, IF_OIDS.speed);
    const admin = mapByIndex(adminRows, IF_OIDS.adminStatus);
    const oper = mapByIndex(operRows, IF_OIDS.operStatus);
    const inOctets = mapByIndex(inRows, IF_OIDS.inOctets);
    const outOctets = mapByIndex(outRows, IF_OIDS.outOctets);
    const inErrors = mapByIndex(inErrorRows, IF_OIDS.inErrors);
    const outErrors = mapByIndex(outErrorRows, IF_OIDS.outErrors);
    const inDiscards = mapByIndex(inDiscardRows, IF_OIDS.inDiscards);
    const outDiscards = mapByIndex(outDiscardRows, IF_OIDS.outDiscards);
    const indexes = [...descr.keys()].sort((a, b) => a - b);

    if (indexes.length === 0) {
      return fallbackPorts();
    }

    return indexes.map((index) => {
      const name = valueToString(descr.get(index)) || `Port ${index}`;
      const speedMbps = Math.round((valueToNumber(speed.get(index)) ?? 0) / 1_000_000) || undefined;

      return {
        index,
        name,
        alias: valueToString(alias.get(index)) || undefined,
        adminStatus: statusFromNumber(admin.get(index)),
        operStatus: statusFromNumber(oper.get(index)),
        speedMbps,
        maxSpeedMbps: maxSpeedMbpsForPort(config, index, name, speedMbps),
        macAddress: valueToMac(physAddress.get(index)),
        inOctets: valueToNumber(inOctets.get(index)),
        outOctets: valueToNumber(outOctets.get(index)),
        inErrors: valueToNumber(inErrors.get(index)),
        outErrors: valueToNumber(outErrors.get(index)),
        inDiscards: valueToNumber(inDiscards.get(index)),
        outDiscards: valueToNumber(outDiscards.get(index)),
        detectedVia: "snmp" as const
      };
    });
  } finally {
    session.close();
  }
}

export async function getVlans(config: ServiceConfig): Promise<VlanInfo[]> {
  const session = createSession(config);
  if (!session) {
    return [];
  }

  try {
    const names = await walk(session, VLAN_NAME_OID);
    const statuses = await walk(session, VLAN_STATUS_OID);
    const egressRows = await walk(session, VLAN_EGRESS_PORTS_OID);
    const untaggedRows = await walk(session, VLAN_UNTAGGED_PORTS_OID);
    const statusById = mapByIndex(statuses, VLAN_STATUS_OID);
    const egressById = mapByIndex(egressRows, VLAN_EGRESS_PORTS_OID);
    const untaggedById = mapByIndex(untaggedRows, VLAN_UNTAGGED_PORTS_OID);

    const rows: VlanInfo[] = [];

    for (const row of names) {
      const id = indexFromOid(row.oid, VLAN_NAME_OID);
      if (id == null) {
        continue;
      }

      const status = vlanStatus(valueToNumber(statusById.get(id)));
      const egressPorts = decodePortBitmap(egressById.get(id));
      const untaggedPorts = decodePortBitmap(untaggedById.get(id));
      const untaggedSet = new Set(untaggedPorts);
      const taggedPorts = egressPorts.filter((port) => !untaggedSet.has(port));
      rows.push({
        id,
        name: valueToString(row.value) || `VLAN ${id}`,
        ...(status ? { status } : {}),
        ...(egressPorts.length ? { egressPorts } : {}),
        ...(taggedPorts.length ? { taggedPorts } : {}),
        ...(untaggedPorts.length ? { untaggedPorts } : {})
      });
    }

    return rows.sort((a, b) => a.id - b.id);
  } finally {
    session.close();
  }
}

export async function getNeighbors(config: ServiceConfig): Promise<SwitchNeighbor[]> {
  const session = createSession(config);
  if (!session) {
    return [];
  }

  try {
    const chassisIds = await walk(session, LLDP_OIDS.chassisId);
    const portIds = await walk(session, LLDP_OIDS.portId);
    const portDescriptions = await walk(session, LLDP_OIDS.portDescription);
    const systemNames = await walk(session, LLDP_OIDS.systemName);
    const systemDescriptions = await walk(session, LLDP_OIDS.systemDescription);
    const neighbors = new Map<string, SwitchNeighbor>();

    const getOrCreate = (baseOid: string, oid: string) => {
      const key = lldpKeyFromOid(oid, baseOid);
      if (!key) {
        return undefined;
      }

      const localPort = lldpLocalPortFromKey(key);
      const existing = neighbors.get(key);
      if (existing) {
        return existing;
      }

      const neighbor: SwitchNeighbor = {
        key,
        ...(localPort ? { localPort, localPortName: String(localPort) } : {})
      };
      neighbors.set(key, neighbor);
      return neighbor;
    };

    for (const row of chassisIds) {
      const neighbor = getOrCreate(LLDP_OIDS.chassisId, row.oid);
      if (neighbor) {
        neighbor.chassisId = valueToMac(row.value) || valueToString(row.value);
      }
    }

    for (const row of portIds) {
      const neighbor = getOrCreate(LLDP_OIDS.portId, row.oid);
      if (neighbor) {
        neighbor.portId = valueToString(row.value);
      }
    }

    for (const row of portDescriptions) {
      const neighbor = getOrCreate(LLDP_OIDS.portDescription, row.oid);
      if (neighbor) {
        neighbor.portDescription = valueToString(row.value);
      }
    }

    for (const row of systemNames) {
      const neighbor = getOrCreate(LLDP_OIDS.systemName, row.oid);
      if (neighbor) {
        neighbor.systemName = valueToString(row.value);
      }
    }

    for (const row of systemDescriptions) {
      const neighbor = getOrCreate(LLDP_OIDS.systemDescription, row.oid);
      if (neighbor) {
        neighbor.systemDescription = valueToString(row.value);
      }
    }

    return [...neighbors.values()].sort((a, b) => (a.localPort ?? 0) - (b.localPort ?? 0));
  } finally {
    session.close();
  }
}

export async function getMacTable(config: ServiceConfig): Promise<SwitchMacEntry[]> {
  const session = createSession(config);
  if (!session) {
    return [];
  }

  try {
    const basePortRows = await walk(session, BRIDGE_OIDS.basePortIfIndex);
    const addressRows = await walk(session, BRIDGE_OIDS.fdbAddress);
    const fdbPortRows = await walk(session, BRIDGE_OIDS.fdbPort);
    const statusRows = await walk(session, BRIDGE_OIDS.fdbStatus);
    const bridgePortToIfIndex = mapByIndex(basePortRows, BRIDGE_OIDS.basePortIfIndex);
    const fdbPortByMac = mapBySuffix(fdbPortRows, BRIDGE_OIDS.fdbPort);
    const statusByMac = mapBySuffix(statusRows, BRIDGE_OIDS.fdbStatus);
    const entries: SwitchMacEntry[] = [];

    for (const row of addressRows) {
      const suffix = suffixFromOid(row.oid, BRIDGE_OIDS.fdbAddress);
      const macAddress = valueToMac(row.value) || macFromOidSuffix(suffix);
      if (!macAddress || !suffix) {
        continue;
      }

      const bridgePort = valueToNumber(fdbPortByMac.get(suffix));
      const resolvedPortIndex = bridgePort == null ? undefined : valueToNumber(bridgePortToIfIndex.get(bridgePort)) ?? bridgePort;
      const portIndex = resolvedPortIndex != null && resolvedPortIndex > 0 ? resolvedPortIndex : undefined;
      const status = fdbStatus(valueToNumber(statusByMac.get(suffix)));
      entries.push({
        macAddress,
        ...(portIndex != null ? { portIndex, portName: String(portIndex) } : {}),
        ...(bridgePort != null ? { bridgePort } : {}),
        ...(status ? { status } : {})
      });
    }

    return entries.sort((a, b) => (a.portIndex ?? 0) - (b.portIndex ?? 0) || a.macAddress.localeCompare(b.macAddress));
  } finally {
    session.close();
  }
}

function vlanStatus(value: number | undefined) {
  switch (value) {
    case 1:
      return "active";
    case 2:
      return "not in service";
    case 3:
      return "not ready";
    case 4:
      return "create and go";
    case 5:
      return "create and wait";
    case 6:
      return "destroy";
    default:
      return undefined;
  }
}

function fallbackPorts(): SwitchPort[] {
  return Array.from({ length: 24 }, (_, index) => ({
    index: index + 1,
    name: `${index + 1}`,
    adminStatus: "unknown",
    operStatus: "unknown",
    maxSpeedMbps: 1000,
    detectedVia: "fallback"
  }));
}
