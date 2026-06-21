export type TcpProbe = {
  port: number;
  name: string;
  open: boolean;
  latencyMs?: number;
  error?: string;
};

export type SystemInfo = {
  host: string;
  label: string;
  sysName?: string;
  sysDescr?: string;
  sysObjectId?: string;
  uptimeTicks?: number;
  uptimeText?: string;
  contact?: string;
  location?: string;
  httpTitle?: string;
  managementPorts: TcpProbe[];
  snmpEnabled: boolean;
  writeCommandsEnabled: boolean;
};

export type PortStatus = "up" | "down" | "testing" | "unknown";

export type SwitchPort = {
  index: number;
  name: string;
  alias?: string;
  adminStatus: PortStatus;
  operStatus: PortStatus;
  speedMbps?: number;
  maxSpeedMbps?: number;
  macAddress?: string;
  inOctets?: number;
  outOctets?: number;
  inErrors?: number;
  outErrors?: number;
  inDiscards?: number;
  outDiscards?: number;
  detectedVia: "snmp" | "fallback";
};

export type VlanInfo = {
  id: number;
  name: string;
  status?: string;
  taggedPorts?: number[];
  untaggedPorts?: number[];
  egressPorts?: number[];
};

export type SwitchNeighbor = {
  key: string;
  localPort?: number;
  localPortName?: string;
  systemName?: string;
  portId?: string;
  portDescription?: string;
  chassisId?: string;
  systemDescription?: string;
};

export type SwitchMacEntry = {
  macAddress: string;
  portIndex?: number;
  portName?: string;
  bridgePort?: number;
  status?: string;
};

export type CliTransport = "ssh" | "telnet";

export type CliResult = {
  transport: CliTransport;
  host: string;
  commands: string[];
  writeBlocked: boolean;
  output: string;
};

export type Credentials = {
  transport: CliTransport;
  username: string;
  password: string;
};
