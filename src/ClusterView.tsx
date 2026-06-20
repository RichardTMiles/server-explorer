import React from "react";
import {
  Boxes,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Layers,
  RefreshCw,
  Server,
  Waypoints,
} from "lucide-react";
import { fetchClusterOverview } from "./api";
import type {
  ClusterLonghornDisk,
  ClusterLonghornVolume,
  ClusterNode,
  ClusterOverview,
  ClusterPod,
  ClusterService,
  ClusterVirtualMachine,
  ClusterWorkload,
} from "./types";

type ClusterSection = "summary" | "kubernetes" | "vms" | "longhorn";

const sectionLabels: Record<ClusterSection, string> = {
  summary: "Summary",
  kubernetes: "Kubernetes",
  vms: "VMs",
  longhorn: "Longhorn",
};

function formatNumber(value: number | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatPct(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function formatBytes(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toLocaleString(undefined, { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

function formatAge(ageMs: number | undefined) {
  if (ageMs == null || !Number.isFinite(ageMs)) return "-";
  const minutes = Math.floor(ageMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function timeLabel(value?: string) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function statusClass(value?: string) {
  const normalized = (value ?? "").toLowerCase();
  if (["ready", "running", "healthy", "bound", "active", "true"].includes(normalized)) return "good";
  if (["notready", "failed", "degraded", "faulted", "detached", "false"].includes(normalized)) return "danger";
  if (["pending", "unknown", "progressing"].includes(normalized)) return "warning";
  return "neutral";
}

function metricBar(value: number | undefined) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  return (
    <span className="metric-bar" aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </span>
  );
}

function SummaryCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="cluster-card">
      <span className="cluster-card-icon">{props.icon}</span>
      <span className="cluster-card-label">{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail ? <small>{props.detail}</small> : null}
    </div>
  );
}

function NodeCard({ node }: { node: ClusterNode }) {
  const disks = node.longhorn?.disks ?? [];
  const unavailable = disks.filter((disk) => !disk.ready || !disk.schedulable).length;

  return (
    <article className="node-card">
      <div className="node-card-heading">
        <div>
          <h3>{node.name}</h3>
          <span>{[node.internalIp, ...node.roles].filter(Boolean).join(" / ")}</span>
        </div>
        <span className={`status-pill compact cluster-${statusClass(node.status)}`}>{node.status}</span>
      </div>
      <div className="node-metrics">
        <div>
          <span>CPU</span>
          <strong>{formatPct(node.metrics.cpuUsagePct)}</strong>
          {metricBar(node.metrics.cpuUsagePct)}
        </div>
        <div>
          <span>Memory</span>
          <strong>{formatPct(node.metrics.memoryUsagePct)}</strong>
          {metricBar(node.metrics.memoryUsagePct)}
        </div>
        <div>
          <span>Root fs</span>
          <strong>{formatPct(node.metrics.rootFsUsagePct)}</strong>
          {metricBar(node.metrics.rootFsUsagePct)}
        </div>
        <div>
          <span>Disk busy</span>
          <strong>{formatPct(node.metrics.diskBusyPct)}</strong>
          {metricBar(node.metrics.diskBusyPct)}
        </div>
      </div>
      <div className="node-foot">
        <span>{disks.length} Longhorn disks</span>
        <span className={unavailable > 0 ? "danger-text" : ""}>{unavailable} unavailable</span>
      </div>
    </article>
  );
}

function SummarySection({ data }: { data: ClusterOverview }) {
  const total = data.totals.longhornStorageMaximumGiB;
  const available = data.totals.longhornStorageAvailableGiB;
  const used = total != null && available != null ? total - available : undefined;

  return (
    <div className="cluster-sections">
      <section>
        <div className="cluster-card-grid">
          <SummaryCard icon={<Server size={18} />} label="Nodes" value={data.summary.nodes} detail="Harvester hosts" />
          <SummaryCard
            icon={<Boxes size={18} />}
            label="Pods"
            value={`${data.summary.runningPods}/${data.summary.pods}`}
            detail="running / total"
          />
          <SummaryCard
            icon={<Layers size={18} />}
            label="Workloads"
            value={data.summary.workloads}
            detail="deployments, sets, jobs"
          />
          <SummaryCard
            icon={<Waypoints size={18} />}
            label="Services"
            value={data.summary.services}
            detail="cluster services"
          />
          <SummaryCard
            icon={<Cpu size={18} />}
            label="VMs"
            value={`${data.summary.runningVirtualMachines}/${data.summary.virtualMachines}`}
            detail="running / total"
          />
          <SummaryCard
            icon={<HardDrive size={18} />}
            label="Longhorn disks"
            value={`${data.summary.readyLonghornDisks}/${data.summary.longhornDisks}`}
            detail="ready / total"
          />
          <SummaryCard
            icon={<Database size={18} />}
            label="Longhorn storage"
            value={formatNumber(used, 1)}
            detail={`GiB used of ${formatNumber(total, 1)} GiB`}
          />
          <SummaryCard
            icon={<Gauge size={18} />}
            label="Metrics source"
            value="Grafana"
            detail="Rancher Prometheus datasource"
          />
        </div>
      </section>

      <section>
        <div className="section-heading">
          <h2>Nodes</h2>
          <span>Realtime metrics</span>
        </div>
        <div className="node-grid">
          {data.nodes.map((node) => (
            <NodeCard key={node.name} node={node} />
          ))}
        </div>
      </section>
    </div>
  );
}

function WorkloadTable({ rows }: { rows: ClusterWorkload[] }) {
  const sorted = [...rows].sort((a, b) => a.kind.localeCompare(b.kind) || a.namespace.localeCompare(b.namespace));
  return (
    <div className="table-wrap">
      <table className="cluster-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Namespace</th>
            <th>Name</th>
            <th>Ready</th>
            <th>Available</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.kind}:${row.namespace}:${row.name}`}>
              <td>{row.kind}</td>
              <td>{row.namespace}</td>
              <td>{row.name}</td>
              <td>
                {row.ready ?? "-"}
                {row.desired != null ? ` / ${row.desired}` : ""}
              </td>
              <td>{row.available ?? "-"}</td>
              <td>{formatAge(row.ageMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PodTable({ rows }: { rows: ClusterPod[] }) {
  const sorted = [...rows].sort((a, b) => {
    const aScore = a.phase === "Running" && a.ready === a.total ? 1 : 0;
    const bScore = b.phase === "Running" && b.ready === b.total ? 1 : 0;
    return aScore - bScore || b.restarts - a.restarts || a.namespace.localeCompare(b.namespace);
  });

  return (
    <div className="table-wrap tall">
      <table className="cluster-table">
        <thead>
          <tr>
            <th>Namespace</th>
            <th>Pod</th>
            <th>Phase</th>
            <th>Ready</th>
            <th>Restarts</th>
            <th>Node</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.namespace}:${row.name}`}>
              <td>{row.namespace}</td>
              <td>{row.name}</td>
              <td>
                <span className={`status-pill compact cluster-${statusClass(row.phase)}`}>{row.phase}</span>
              </td>
              <td>
                {row.ready}/{row.total}
              </td>
              <td>{row.restarts}</td>
              <td>{row.nodeName ?? "-"}</td>
              <td>{row.owner ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServiceTable({ rows }: { rows: ClusterService[] }) {
  return (
    <div className="table-wrap">
      <table className="cluster-table">
        <thead>
          <tr>
            <th>Namespace</th>
            <th>Service</th>
            <th>Type</th>
            <th>Cluster IP</th>
            <th>Ports</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.namespace}:${row.name}`}>
              <td>{row.namespace}</td>
              <td>{row.name}</td>
              <td>{row.type}</td>
              <td>{row.clusterIp ?? "-"}</td>
              <td>
                {row.ports
                  .map((port) => [port.name, port.port, port.nodePort ? `node ${port.nodePort}` : undefined].filter(Boolean).join(":"))
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KubernetesSection({ data }: { data: ClusterOverview }) {
  return (
    <div className="cluster-sections">
      <section>
        <div className="section-heading">
          <h2>Workloads</h2>
          <span>{data.workloads.length} controllers and jobs</span>
        </div>
        <WorkloadTable rows={data.workloads} />
      </section>
      <section>
        <div className="section-heading">
          <h2>Pods</h2>
          <span>{data.pods.length} pods</span>
        </div>
        <PodTable rows={data.pods} />
      </section>
      <section>
        <div className="section-heading">
          <h2>Services</h2>
          <span>{data.services.length} services</span>
        </div>
        <ServiceTable rows={data.services} />
      </section>
    </div>
  );
}

function VmSection({ rows }: { rows: ClusterVirtualMachine[] }) {
  return (
    <section>
      <div className="section-heading">
        <h2>Virtual Machines</h2>
        <span>{rows.length} KubeVirt VMs</span>
      </div>
      <div className="table-wrap">
        <table className="cluster-table">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Name</th>
              <th>Status</th>
              <th>Node</th>
              <th>IP</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Volumes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.namespace}:${row.name}`}>
                <td>{row.namespace}</td>
                <td>{row.name}</td>
                <td>
                  <span className={`status-pill compact cluster-${statusClass(row.printableStatus)}`}>
                    {row.printableStatus}
                  </span>
                </td>
                <td>{row.nodeName ?? "-"}</td>
                <td>{row.ip ?? "-"}</td>
                <td>{String(row.cpu ?? "-")}</td>
                <td>{String(row.memory ?? "-")}</td>
                <td>{row.volumes.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DiskTable({ rows }: { rows: ClusterLonghornDisk[] }) {
  const sorted = [...rows].sort((a, b) => (a.node ?? "").localeCompare(b.node ?? "") || a.id.localeCompare(b.id));
  return (
    <div className="table-wrap tall">
      <table className="cluster-table">
        <thead>
          <tr>
            <th>Node</th>
            <th>Disk</th>
            <th>Ready</th>
            <th>Sched</th>
            <th>Used</th>
            <th>Scheduled</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.node}:${row.id}`}>
              <td>{row.node}</td>
              <td>{row.id}</td>
              <td>
                <span className={`status-pill compact cluster-${statusClass(String(row.ready))}`}>
                  {row.ready ? "Ready" : "Not ready"}
                </span>
              </td>
              <td>{row.schedulable ? "Yes" : "No"}</td>
              <td>
                {formatPct(row.usedPct)}
                {metricBar(row.usedPct)}
              </td>
              <td>
                {formatBytes(row.scheduledReplicaBytes)}
                {metricBar(row.scheduledPct)}
              </td>
              <td>{row.path ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VolumeTable({ rows }: { rows: ClusterLonghornVolume[] }) {
  const sorted = [...rows].sort((a, b) => statusClass(a.robustness).localeCompare(statusClass(b.robustness)));
  return (
    <div className="table-wrap">
      <table className="cluster-table">
        <thead>
          <tr>
            <th>Namespace</th>
            <th>Volume</th>
            <th>State</th>
            <th>Robustness</th>
            <th>Node</th>
            <th>Size</th>
            <th>Actual</th>
            <th>Replicas</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.namespace}:${row.name}`}>
              <td>{row.namespace}</td>
              <td>{row.name}</td>
              <td>{row.state ?? "-"}</td>
              <td>
                <span className={`status-pill compact cluster-${statusClass(row.robustness)}`}>
                  {row.robustness ?? "-"}
                </span>
              </td>
              <td>{row.nodeId ?? "-"}</td>
              <td>{formatBytes(row.sizeBytes)}</td>
              <td>{formatBytes(row.actualSizeBytes)}</td>
              <td>{row.numberOfReplicas ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LonghornSection({ data }: { data: ClusterOverview }) {
  return (
    <div className="cluster-sections">
      <section>
        <div className="section-heading">
          <h2>Longhorn Disks</h2>
          <span>
            {formatNumber(data.totals.longhornStorageAvailableGiB, 1)} GiB available /{" "}
            {formatNumber(data.totals.longhornStorageMaximumGiB, 1)} GiB total
          </span>
        </div>
        <DiskTable rows={data.storage.longhorn.disks} />
      </section>
      <section>
        <div className="section-heading">
          <h2>Longhorn Volumes</h2>
          <span>
            {data.summary.healthyLonghornVolumes}/{data.summary.longhornVolumes} healthy
          </span>
        </div>
        <VolumeTable rows={data.storage.longhorn.volumes} />
      </section>
    </div>
  );
}

export function ClusterView() {
  const [section, setSection] = React.useState<ClusterSection>("summary");
  const [data, setData] = React.useState<ClusterOverview>();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();

  const load = React.useCallback(async () => {
    setError(undefined);
    try {
      setData(await fetchClusterOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(interval);
  }, [load]);

  return (
    <main className="cluster-view">
      <div className="cluster-toolbar">
        <div className="cluster-tabs" role="tablist" aria-label="Cluster sections">
          {(Object.keys(sectionLabels) as ClusterSection[]).map((key) => (
            <button
              key={key}
              type="button"
              className={section === key ? "active" : ""}
              onClick={() => setSection(key)}
            >
              {sectionLabels[key]}
            </button>
          ))}
        </div>
        <div className="cluster-refresh">
          <span>{loading ? "Loading" : `Updated ${timeLabel(data?.updatedAt)}`}</span>
          <button type="button" className="icon-button" onClick={() => void load()} title="Refresh cluster">
            <RefreshCw size={17} />
          </button>
        </div>
      </div>

      {error ? <div className="header-error">{error}</div> : null}
      {data?.warnings.length ? (
        <div className="cluster-alerts">
          {data.warnings.slice(0, 4).map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      {!data ? (
        <section className="loading-state">
          <Server size={30} />
          <h2>{loading ? "Loading cluster" : "Cluster unavailable"}</h2>
          <p>{error ?? "Waiting for Kubernetes and metrics data."}</p>
        </section>
      ) : null}

      {data && section === "summary" ? <SummarySection data={data} /> : null}
      {data && section === "kubernetes" ? <KubernetesSection data={data} /> : null}
      {data && section === "vms" ? <VmSection rows={data.virtualMachines} /> : null}
      {data && section === "longhorn" ? <LonghornSection data={data} /> : null}
    </main>
  );
}
