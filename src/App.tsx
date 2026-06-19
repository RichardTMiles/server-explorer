import React from "react";
import {
  Activity,
  Cable,
  Cpu,
  ExternalLink,
  Filter,
  HardDrive,
  Network,
  Power,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { fetchTopology, probeDevice } from "./api";
import type {
  DeviceCategory,
  DeviceStatus,
  LinkKind,
  ProbeResult,
  Topology,
  TopologyDevice,
  TopologyLink,
} from "./types";

const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: "Online",
  degraded: "Degraded",
  offline: "Offline",
  unknown: "Unknown",
};

const CATEGORY_LABEL: Record<DeviceCategory, string> = {
  external: "External",
  network: "Network",
  compute: "Compute",
  storage: "Storage",
  power: "Power",
  management: "Management",
  kvm: "KVM",
  utility: "Utility",
};

const LINK_LABEL: Record<LinkKind, string> = {
  network: "Network",
  management: "Remote Management",
  storage: "Storage",
  power: "Power",
  kvm: "KVM",
  serial: "Serial",
};

const CATEGORY_ICON: Record<DeviceCategory, React.ReactNode> = {
  external: <Network size={16} />,
  network: <Network size={16} />,
  compute: <Server size={16} />,
  storage: <HardDrive size={16} />,
  power: <Power size={16} />,
  management: <ShieldCheck size={16} />,
  kvm: <TerminalSquare size={16} />,
  utility: <Cpu size={16} />,
};

const statusRank: Record<DeviceStatus, number> = {
  offline: 0,
  degraded: 1,
  unknown: 2,
  online: 3,
};

const defaultStatuses = new Set<DeviceStatus>(["online", "degraded", "offline", "unknown"]);
const defaultCategories = new Set<DeviceCategory>([
  "external",
  "network",
  "compute",
  "storage",
  "power",
  "management",
  "kvm",
  "utility",
]);

function formatUpdatedAt(value?: string) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isRackDevice(device: TopologyDevice) {
  return typeof device.rackUnit === "number" && device.rackUnit > 0;
}

function deviceMatchesFilters(
  device: TopologyDevice,
  search: string,
  statuses: Set<DeviceStatus>,
  categories: Set<DeviceCategory>
) {
  if (!statuses.has(device.status) || !categories.has(device.category)) return false;
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  return [
    device.label,
    device.category,
    device.vendor,
    device.model,
    device.role,
    device.summary,
    device.ip,
    ...device.tags,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function summarizeDevices(devices: TopologyDevice[]) {
  return devices.reduce(
    (summary, device) => {
      summary.total += 1;
      summary[device.status] += 1;
      return summary;
    },
    { total: 0, online: 0, degraded: 0, offline: 0, unknown: 0 }
  );
}

function linkEndpointLabel(topology: Topology, link: TopologyLink, side: "from" | "to") {
  const endpoint = link[side];
  const device = topology.devices.find((item) => item.id === endpoint.deviceId);
  const port = device?.ports.find((item) => item.id === endpoint.portId);
  return [device?.label ?? endpoint.deviceId, port?.label].filter(Boolean).join(" / ");
}

function TopologyHeader(props: {
  topology?: Topology;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
}) {
  const { topology, loading, error, onRefresh } = props;
  const summary = summarizeDevices(topology?.devices ?? []);

  return (
    <header className="app-header">
      <div>
        <div className="eyebrow">{topology?.site ?? "Infrastructure"}</div>
        <h1>{topology?.title ?? "Server Explorer"}</h1>
        <div className="subtle">Updated {formatUpdatedAt(topology?.updatedAt)}</div>
      </div>
      <div className="header-actions">
        <div className="status-strip" aria-label="Device status summary">
          <span className="status-chip status-online">{summary.online} online</span>
          <span className="status-chip status-degraded">{summary.degraded} degraded</span>
          <span className="status-chip status-offline">{summary.offline} offline</span>
          <span className="status-chip status-unknown">{summary.unknown} unknown</span>
        </div>
        <button type="button" className="icon-button" onClick={onRefresh} disabled={loading} title="Refresh topology">
          <RefreshCw size={18} />
        </button>
      </div>
      {error ? <div className="header-error">{error}</div> : null}
    </header>
  );
}

function FilterToggle<T extends string>(props: {
  value: T;
  label: string;
  selected: boolean;
  onToggle: (value: T) => void;
}) {
  return (
    <button
      type="button"
      className={`filter-toggle${props.selected ? " active" : ""}`}
      onClick={() => props.onToggle(props.value)}
    >
      {props.label}
    </button>
  );
}

function Filters(props: {
  search: string;
  setSearch: (value: string) => void;
  statuses: Set<DeviceStatus>;
  setStatuses: (value: Set<DeviceStatus>) => void;
  categories: Set<DeviceCategory>;
  setCategories: (value: Set<DeviceCategory>) => void;
}) {
  const toggleStatus = (status: DeviceStatus) => {
    const next = new Set(props.statuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    props.setStatuses(next.size === 0 ? new Set(defaultStatuses) : next);
  };

  const toggleCategory = (category: DeviceCategory) => {
    const next = new Set(props.categories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    props.setCategories(next.size === 0 ? new Set(defaultCategories) : next);
  };

  return (
    <section className="filters" aria-label="Explorer filters">
      <div className="search-field">
        <Search size={17} />
        <input
          value={props.search}
          onChange={(event) => props.setSearch(event.target.value)}
          placeholder="Search devices, roles, tags, IPs"
        />
      </div>
      <div className="filter-group">
        <Filter size={15} />
        {(Object.keys(STATUS_LABEL) as DeviceStatus[]).map((status) => (
          <FilterToggle
            key={status}
            value={status}
            label={STATUS_LABEL[status]}
            selected={props.statuses.has(status)}
            onToggle={toggleStatus}
          />
        ))}
      </div>
      <div className="filter-group category-group">
        {(Object.keys(CATEGORY_LABEL) as DeviceCategory[]).map((category) => (
          <FilterToggle
            key={category}
            value={category}
            label={CATEGORY_LABEL[category]}
            selected={props.categories.has(category)}
            onToggle={toggleCategory}
          />
        ))}
      </div>
    </section>
  );
}

function CableOverlay(props: {
  topology: Topology;
  visibleDevices: TopologyDevice[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
}) {
  const rackDevices = props.topology.devices.filter(isRackDevice);
  const externalDevices = props.topology.devices.filter((device) => !isRackDevice(device));
  const visibleDeviceIds = new Set(props.visibleDevices.map((device) => device.id));
  const deviceById = new Map(props.topology.devices.map((device) => [device.id, device]));
  const externalIndexById = new Map(externalDevices.map((device, index) => [device.id, index]));

  const anchor = (deviceId: string, side: "left" | "right") => {
    const device = deviceById.get(deviceId);
    if (!device) return { x: side === "left" ? 8 : 92, y: 50 };
    if (isRackDevice(device)) {
      const rackUnit = device.rackUnit ?? 1;
      const y = ((props.topology.rack.units - (rackUnit + device.rackHeight / 2) + 1) / props.topology.rack.units) * 100;
      return { x: side === "left" ? 47 : 78, y };
    }
    const index = externalIndexById.get(device.id) ?? 0;
    const gap = 100 / Math.max(externalDevices.length + 1, 2);
    return { x: 13, y: gap * (index + 1) };
  };

  const visibleLinks = props.topology.links.filter((link) => {
    return visibleDeviceIds.has(link.from.deviceId) || visibleDeviceIds.has(link.to.deviceId);
  });

  return (
    <svg className="cable-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {visibleLinks.map((link) => {
        const fromDevice = deviceById.get(link.from.deviceId);
        const toDevice = deviceById.get(link.to.deviceId);
        const from = anchor(link.from.deviceId, "right");
        const to = anchor(link.to.deviceId, "left");
        const isSelected =
          props.selectedDeviceId === link.from.deviceId || props.selectedDeviceId === link.to.deviceId;
        const muted =
          props.selectedDeviceId &&
          props.selectedDeviceId !== link.from.deviceId &&
          props.selectedDeviceId !== link.to.deviceId;
        const midX = from.x + (to.x - from.x) * 0.45;
        const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
        const canSelect = fromDevice || toDevice;

        return (
          <path
            key={link.id}
            d={path}
            className={`cable cable-${link.kind} status-${link.status}${isSelected ? " selected" : ""}${muted ? " muted" : ""}`}
            onClick={() => {
              if (!canSelect) return;
              props.onSelectDevice(toDevice?.id ?? fromDevice?.id ?? "");
            }}
          />
        );
      })}
      {rackDevices.map((device) => {
        const point = anchor(device.id, "left");
        const selected = props.selectedDeviceId === device.id;
        return (
          <circle
            key={device.id}
            className={`rack-anchor status-${device.status}${selected ? " selected" : ""}`}
            cx={point.x}
            cy={point.y}
            r={selected ? 0.95 : 0.7}
          />
        );
      })}
    </svg>
  );
}

function RackView(props: {
  topology: Topology;
  visibleDevices: TopologyDevice[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
}) {
  const visibleDeviceIds = new Set(props.visibleDevices.map((device) => device.id));
  const rackDevices = props.topology.devices
    .filter(isRackDevice)
    .filter((device) => visibleDeviceIds.has(device.id))
    .sort((a, b) => statusRank[a.status] - statusRank[b.status] || (b.rackUnit ?? 0) - (a.rackUnit ?? 0));
  const externalDevices = props.topology.devices
    .filter((device) => !isRackDevice(device))
    .filter((device) => visibleDeviceIds.has(device.id));
  const units = props.topology.rack.units;

  return (
    <section className="topology-stage" aria-label="Rack topology">
      <div className="external-stack">
        {externalDevices.map((device) => (
          <button
            type="button"
            key={device.id}
            className={`external-node status-${device.status}${props.selectedDeviceId === device.id ? " selected" : ""}`}
            onClick={() => props.onSelectDevice(device.id)}
          >
            <span className="node-icon">{CATEGORY_ICON[device.category]}</span>
            <span>{device.label}</span>
          </button>
        ))}
      </div>

      <CableOverlay
        topology={props.topology}
        visibleDevices={props.visibleDevices}
        selectedDeviceId={props.selectedDeviceId}
        onSelectDevice={props.onSelectDevice}
      />

      <div className="rack-shell">
        <div className="rack-title">{props.topology.rack.label}</div>
        <div className="rack-grid" style={{ gridTemplateRows: `repeat(${units}, minmax(9px, 1fr))` }}>
          {Array.from({ length: units }, (_, index) => {
            const unit = units - index;
            return (
              <div key={unit} className="rack-unit-line" style={{ gridRow: `${index + 1}` }}>
                <span>{unit}</span>
              </div>
            );
          })}
          {rackDevices.map((device) => {
            const rackUnit = device.rackUnit ?? 1;
            const gridStart = units - rackUnit - device.rackHeight + 2;
            return (
              <button
                type="button"
                key={device.id}
                className={`rack-device category-${device.category} status-${device.status}${props.selectedDeviceId === device.id ? " selected" : ""}`}
                style={{ gridRow: `${gridStart} / span ${device.rackHeight}` }}
                onClick={() => props.onSelectDevice(device.id)}
              >
                <span className="rack-device-label">
                  <span className="node-icon">{CATEGORY_ICON[device.category]}</span>
                  <span>{device.label}</span>
                </span>
                <span className="rack-device-model">{device.model ?? CATEGORY_LABEL[device.category]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="legend-panel">
        <h2>Legend</h2>
        {(Object.keys(LINK_LABEL) as LinkKind[]).map((kind) => (
          <div key={kind} className="legend-row">
            <span className={`legend-line cable-${kind}`} />
            <span>{LINK_LABEL[kind]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeviceList(props: {
  devices: TopologyDevice[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
}) {
  return (
    <section className="device-list" aria-label="Device list">
      {props.devices.map((device) => (
        <button
          type="button"
          key={device.id}
          className={`device-row status-${device.status}${props.selectedDeviceId === device.id ? " selected" : ""}`}
          onClick={() => props.onSelectDevice(device.id)}
        >
          <span className="node-icon">{CATEGORY_ICON[device.category]}</span>
          <span className="device-row-main">
            <span className="device-row-title">{device.label}</span>
            <span className="device-row-subtitle">
              {[CATEGORY_LABEL[device.category], device.model, device.role].filter(Boolean).join(" / ")}
            </span>
          </span>
          <span className={`status-dot status-${device.status}`} />
        </button>
      ))}
    </section>
  );
}

function DeviceInspector(props: {
  topology: Topology;
  device?: TopologyDevice;
  probeResult?: ProbeResult;
  probeLoading: boolean;
  probeError?: string;
  onProbe: (deviceId: string) => void;
}) {
  const { topology, device } = props;
  if (!device) {
    return (
      <aside className="inspector empty">
        <Server size={28} />
        <h2>Select a device</h2>
        <p>Choose a rack device, upstream node, or cable endpoint to inspect its role, ports, links, and runtime notes.</p>
      </aside>
    );
  }

  const links = topology.links.filter((link) => link.from.deviceId === device.id || link.to.deviceId === device.id);

  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <span className="node-icon large">{CATEGORY_ICON[device.category]}</span>
        <div>
          <div className="eyebrow">{CATEGORY_LABEL[device.category]}</div>
          <h2>{device.label}</h2>
          <span className={`status-pill status-${device.status}`}>{STATUS_LABEL[device.status]}</span>
        </div>
      </div>

      <dl className="facts">
        {device.role ? (
          <>
            <dt>Role</dt>
            <dd>{device.role}</dd>
          </>
        ) : null}
        {device.model ? (
          <>
            <dt>Model</dt>
            <dd>{[device.vendor, device.model].filter(Boolean).join(" ")}</dd>
          </>
        ) : null}
        {isRackDevice(device) ? (
          <>
            <dt>Rack</dt>
            <dd>
              U{device.rackUnit} / {device.rackHeight}U
            </dd>
          </>
        ) : null}
        {device.ip ? (
          <>
            <dt>IP</dt>
            <dd>{device.ip}</dd>
          </>
        ) : null}
      </dl>

      {device.summary ? <p className="summary">{device.summary}</p> : null}

      {device.managementUrl ? (
        <a className="management-link" href={device.managementUrl} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={15} />
          Open management
        </a>
      ) : null}

      <div className="metric-grid">
        {device.metrics.map((metric) => (
          <div key={`${metric.label}:${metric.value}`} className={`metric metric-${metric.tone}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      <section className="inspector-section">
        <h3>Ports</h3>
        {device.ports.length === 0 ? (
          <p className="muted">No ports configured.</p>
        ) : (
          <div className="port-list">
            {device.ports.map((port) => (
              <div key={port.id} className="port-row">
                <Cable size={14} />
                <span>{port.label}</span>
                <span className={`status-pill compact status-${port.status}`}>{STATUS_LABEL[port.status]}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="inspector-section">
        <h3>Links</h3>
        {links.length === 0 ? (
          <p className="muted">No links configured.</p>
        ) : (
          <div className="link-list">
            {links.map((link) => (
              <div key={link.id} className={`link-row cable-${link.kind}`}>
                <span>{LINK_LABEL[link.kind]}</span>
                <small>
                  {linkEndpointLabel(topology, link, "from")}{" -> "}
                  {linkEndpointLabel(topology, link, "to")}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="inspector-section">
        <div className="probe-heading">
          <h3>Probe</h3>
          <button
            type="button"
            className="text-button"
            disabled={!device.probe || props.probeLoading}
            onClick={() => props.onProbe(device.id)}
          >
            <Activity size={14} />
            {props.probeLoading ? "Running" : "Run"}
          </button>
        </div>
        {!device.probe ? <p className="muted">No probe target configured.</p> : null}
        {props.probeError ? <p className="probe-error">{props.probeError}</p> : null}
        {props.probeResult ? (
          <div className={`probe-result ${props.probeResult.ok ? "ok" : "failed"}`}>
            <strong>{props.probeResult.ok ? "Reachable" : "Failed"}</strong>
            <span>
              {props.probeResult.target} in {props.probeResult.elapsedMs}ms
              {props.probeResult.status ? ` / HTTP ${props.probeResult.status}` : ""}
            </span>
            {props.probeResult.error ? <small>{props.probeResult.error}</small> : null}
          </div>
        ) : null}
      </section>
    </aside>
  );
}

function AlertFeed(props: { topology: Topology; onSelectDevice: (deviceId: string) => void }) {
  return (
    <section className="alert-feed" aria-label="Alerts">
      <h2>Signals</h2>
      {props.topology.alerts.length === 0 ? (
        <p className="muted">No active alerts.</p>
      ) : (
        props.topology.alerts.map((alert) => (
          <button
            type="button"
            key={alert.id}
            className={`alert-row alert-${alert.severity}`}
            onClick={() => alert.deviceId && props.onSelectDevice(alert.deviceId)}
            disabled={!alert.deviceId}
          >
            <span>{alert.title}</span>
            {alert.detail ? <small>{alert.detail}</small> : null}
          </button>
        ))
      )}
    </section>
  );
}

export function App() {
  const [topology, setTopology] = React.useState<Topology>();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();
  const [search, setSearch] = React.useState("");
  const [statuses, setStatuses] = React.useState<Set<DeviceStatus>>(() => new Set(defaultStatuses));
  const [categories, setCategories] = React.useState<Set<DeviceCategory>>(() => new Set(defaultCategories));
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string>();
  const [probeResults, setProbeResults] = React.useState<Record<string, ProbeResult>>({});
  const [probeLoadingById, setProbeLoadingById] = React.useState<Record<string, boolean>>({});
  const [probeErrorById, setProbeErrorById] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const payload = await fetchTopology();
      setTopology(payload);
      setSelectedDeviceId((current) => current ?? payload.devices.find((device) => device.status !== "online")?.id ?? payload.devices[0]?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const visibleDevices = React.useMemo(() => {
    return (topology?.devices ?? [])
      .filter((device) => deviceMatchesFilters(device, search, statuses, categories))
      .sort((a, b) => statusRank[a.status] - statusRank[b.status] || a.label.localeCompare(b.label));
  }, [categories, search, statuses, topology]);

  const selectedDevice = topology?.devices.find((device) => device.id === selectedDeviceId);

  const runProbe = async (deviceId: string) => {
    setProbeLoadingById((current) => ({ ...current, [deviceId]: true }));
    setProbeErrorById((current) => ({ ...current, [deviceId]: "" }));
    try {
      const result = await probeDevice(deviceId);
      setProbeResults((current) => ({ ...current, [deviceId]: result }));
    } catch (err) {
      setProbeErrorById((current) => ({
        ...current,
        [deviceId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setProbeLoadingById((current) => ({ ...current, [deviceId]: false }));
    }
  };

  return (
    <div className="app-shell">
      <TopologyHeader topology={topology} loading={loading} error={error} onRefresh={() => void load()} />
      <Filters
        search={search}
        setSearch={setSearch}
        statuses={statuses}
        setStatuses={setStatuses}
        categories={categories}
        setCategories={setCategories}
      />

      {topology ? (
        <main className="workspace">
          <div className="left-rail">
            <DeviceList devices={visibleDevices} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} />
            <AlertFeed topology={topology} onSelectDevice={setSelectedDeviceId} />
          </div>
          <RackView
            topology={topology}
            visibleDevices={visibleDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
          />
          <DeviceInspector
            topology={topology}
            device={selectedDevice}
            probeResult={selectedDeviceId ? probeResults[selectedDeviceId] : undefined}
            probeLoading={selectedDeviceId ? Boolean(probeLoadingById[selectedDeviceId]) : false}
            probeError={selectedDeviceId ? probeErrorById[selectedDeviceId] : undefined}
            onProbe={(deviceId) => void runProbe(deviceId)}
          />
        </main>
      ) : (
        <main className="loading-state">
          <Server size={32} />
          <h2>{loading ? "Loading topology" : "Topology unavailable"}</h2>
          <p>{error ?? "Waiting for the server explorer API."}</p>
        </main>
      )}
    </div>
  );
}
