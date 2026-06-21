import { Activity, Search, Server, TerminalSquare } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { formatDuplexRate, formatLineRate, formatPercent, formatRate, sumPortRates, type PortRateMap } from "./switchTraffic";
import type { SwitchMacEntry, SwitchPort } from "./switchTypes";

type TrafficViewProps = {
  ports: SwitchPort[];
  portRates: PortRateMap;
  macEntries: SwitchMacEntry[];
  onRunPreset: (commands: string[]) => Promise<void>;
};

export function TrafficView({ ports, portRates, macEntries, onRunPreset }: TrafficViewProps) {
  const [macQuery, setMacQuery] = useState("");
  const totalRate = sumPortRates(ports, portRates);
  const learnedMacEntries = useMemo(() => macEntries.filter((entry) => entry.status !== "self"), [macEntries]);
  const macCountByPort = useMemo(() => countMacsByPort(learnedMacEntries), [learnedMacEntries]);
  const trafficRows = useMemo(
    () =>
      ports
        .map((port) => ({
          port,
          rate: portRates[port.index],
          macCount: macCountByPort.get(port.index) ?? 0
        }))
        .sort((a, b) => (b.rate?.totalBytesPerSecond ?? 0) - (a.rate?.totalBytesPerSecond ?? 0) || a.port.index - b.port.index),
    [macCountByPort, portRates, ports]
  );
  const maxRate = Math.max(...trafficRows.map((row) => row.rate?.totalBytesPerSecond ?? 0), 1);
  const physicalPortRows = useMemo(() => buildPhysicalPortRows(ports), [ports]);
  const laneRows = trafficRows.filter((row) => row.port.operStatus === "up" || (row.rate?.totalBytesPerSecond ?? 0) > 0 || row.macCount > 0).slice(0, 8);
  const activePortCount = ports.filter((port) => port.operStatus === "up").length;
  const activeCapacityMbps = ports.reduce((total, port) => (port.operStatus === "up" ? total + (port.maxSpeedMbps ?? port.speedMbps ?? 0) : total), 0);
  const peakUtilization = Math.max(...trafficRows.map((row) => row.rate?.utilizationPercent ?? 0), 0);
  const peakRow = trafficRows[0];
  const filteredMacs = learnedMacEntries
    .filter((entry) => `${entry.macAddress} ${entry.portName ?? ""} ${entry.portIndex ?? ""} ${entry.status ?? ""}`.toLowerCase().includes(macQuery.toLowerCase()))
    .slice(0, 80);

  return (
    <div className="traffic-console">
      <section className="traffic-panel traffic-left">
        <div className="section-heading">
          <div>
            <h2>Live Rates</h2>
            <p>Counter deltas from IF-MIB.</p>
          </div>
          <Activity size={20} />
        </div>

        <div className="traffic-total">
          <div>
            <span>Downstream</span>
            <strong>{formatRate(totalRate.inBytesPerSecond)}</strong>
          </div>
          <div>
            <span>Upstream</span>
            <strong>{formatRate(totalRate.outBytesPerSecond)}</strong>
          </div>
        </div>

        <div className="traffic-port-list">
          {trafficRows.slice(0, 24).map((row) => {
            const strength = Math.min(((row.rate?.totalBytesPerSecond ?? 0) / maxRate) * 100, 100);
            return (
              <div
                className={`traffic-port-row ${row.port.operStatus}`}
                key={row.port.index}
                style={{ "--traffic-level": `${Math.max(strength, row.port.operStatus === "up" ? 4 : 0)}%` } as CSSProperties}
              >
                <span className="traffic-port-index">{row.port.index}</span>
                <span className="traffic-port-meter" />
                <span className="traffic-port-rate">
                  <strong>{formatRate(row.rate?.totalBytesPerSecond)}</strong>
                  <em>{formatLineRate(row.port.maxSpeedMbps)} line</em>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="traffic-fabric-panel">
        <div className="fabric-header">
          <div>
            <span className="eyebrow">Switch Fabric</span>
            <h2>Port Traffic Board</h2>
            <p>Physical order, line capacity, sampled rates, and learned-device density.</p>
          </div>
          <div className="fabric-stat-strip">
            <div>
              <span>Total</span>
              <strong>{formatRate(totalRate.totalBytesPerSecond)}</strong>
            </div>
            <div>
              <span>Active</span>
              <strong>{activePortCount}/24</strong>
            </div>
            <div>
              <span>Capacity</span>
              <strong>{formatLineRate(activeCapacityMbps)}</strong>
            </div>
            <div>
              <span>Peak</span>
              <strong>{peakRow ? `${peakRow.port.index} / ${formatPercent(peakUtilization)}` : "-"}</strong>
            </div>
          </div>
        </div>

        <div className="fabric-port-grid">
          {physicalPortRows.map((row, rowIndex) => (
            <div className="fabric-port-row" key={rowIndex === 0 ? "odd" : "even"}>
              {row.map((port) => {
                const rate = portRates[port.index];
                const totalBytesPerSecond = rate?.totalBytesPerSecond ?? 0;
                const capacityBytes = capacityBytesPerSecond(port);
                const heatLevel = Math.max((totalBytesPerSecond / maxRate) * 100, totalBytesPerSecond > 0 ? 5 : 0);
                const inLevel = capacityBytes ? Math.min(((rate?.inBytesPerSecond ?? 0) / capacityBytes) * 100, 100) : 0;
                const outLevel = capacityBytes ? Math.min(((rate?.outBytesPerSecond ?? 0) / capacityBytes) * 100, 100) : 0;
                const macCount = macCountByPort.get(port.index) ?? 0;

                return (
                  <div
                    className={`fabric-port-tile ${port.operStatus} ${totalBytesPerSecond > 0 ? "active" : ""}`}
                    key={port.index}
                    style={
                      {
                        "--heat-level": `${Math.min(heatLevel, 100)}%`,
                        "--in-level": `${Math.max(inLevel, totalBytesPerSecond > 0 ? 2 : 0)}%`,
                        "--out-level": `${Math.max(outLevel, totalBytesPerSecond > 0 ? 2 : 0)}%`
                      } as CSSProperties
                    }
                    title={`${port.name}: ${formatRate(totalBytesPerSecond)}, ${formatLineRate(port.maxSpeedMbps ?? port.speedMbps)} max, ${formatMacCount(macCount)}`}
                  >
                    <span className="fabric-port-fill" />
                    <span className="fabric-port-topline">
                      <strong>{port.index}</strong>
                      <em>{formatCompactStatus(port.operStatus)}</em>
                    </span>
                    <span className="fabric-port-rate">{formatRate(totalBytesPerSecond)}</span>
                    <span className="fabric-port-max">{formatLineRate(port.maxSpeedMbps ?? port.speedMbps)} max</span>
                    <span className="fabric-port-mini-bars">
                      <i className="fabric-port-in" />
                      <i className="fabric-port-out" />
                    </span>
                    <span className="fabric-port-macs">{formatMacCount(macCount)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="fabric-lanes">
          <div className="fabric-lanes-heading">
            <strong>Top Talkers</strong>
            <span>Directional load compared with each port line rate.</span>
          </div>
          {laneRows.map((row) => {
            const capacityBytes = capacityBytesPerSecond(row.port);
            const inLevel = capacityBytes ? Math.min(((row.rate?.inBytesPerSecond ?? 0) / capacityBytes) * 100, 100) : 0;
            const outLevel = capacityBytes ? Math.min(((row.rate?.outBytesPerSecond ?? 0) / capacityBytes) * 100, 100) : 0;

            return (
              <div
                className={`fabric-lane ${row.port.operStatus}`}
                key={row.port.index}
                style={
                  {
                    "--in-level": `${Math.max(inLevel, (row.rate?.inBytesPerSecond ?? 0) > 0 ? 2 : 0)}%`,
                    "--out-level": `${Math.max(outLevel, (row.rate?.outBytesPerSecond ?? 0) > 0 ? 2 : 0)}%`
                  } as CSSProperties
                }
              >
                <span className="fabric-lane-port">
                  <strong>{row.port.index}</strong>
                  <em>{formatMacCount(row.macCount)}</em>
                </span>
                <span className="fabric-lane-body">
                  <span className="fabric-lane-meta">
                    <strong>{row.port.name}</strong>
                    <em>{formatLineRate(row.port.maxSpeedMbps ?? row.port.speedMbps)} max</em>
                  </span>
                  <span className="fabric-lane-bar in" />
                  <span className="fabric-lane-bar out" />
                </span>
                <span className="fabric-lane-rate">
                  <strong>{formatRate(row.rate?.totalBytesPerSecond)}</strong>
                  <em>{formatPercent(row.rate?.utilizationPercent)}</em>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="traffic-panel traffic-right">
        <div className="section-heading">
          <div>
            <h2>Learned Devices</h2>
            <p>BRIDGE-MIB forwarding table.</p>
          </div>
          <Server size={20} />
        </div>

        <label className="compact-field">
          <Search size={16} />
          <input value={macQuery} onChange={(event) => setMacQuery(event.target.value)} placeholder="Filter MACs" />
        </label>

        <div className="traffic-summary-list">
          <div>
            <span>Total MACs</span>
            <strong>{learnedMacEntries.length}</strong>
          </div>
          <div>
            <span>Visible Ports</span>
            <strong>{new Set(learnedMacEntries.map((entry) => entry.portIndex).filter(Boolean)).size}</strong>
          </div>
          <div>
            <span>Top Port</span>
            <strong>{trafficRows[0] ? `${trafficRows[0].port.index} / ${formatDuplexRate(trafficRows[0].port.maxSpeedMbps)}` : "-"}</strong>
          </div>
        </div>

        <div className="mac-table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>MAC</th>
                <th>Port</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredMacs.map((entry) => (
                <tr key={`${entry.macAddress}-${entry.portIndex ?? "unknown"}`}>
                  <td>{entry.macAddress}</td>
                  <td>{entry.portName || entry.portIndex || "?"}</td>
                  <td>{entry.status || "learned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredMacs.length === 0 ? <div className="traffic-empty">No learned MAC rows.</div> : null}
        </div>

        <div className="inspection-boundary">
          <strong>Packet Capture</strong>
          <span>Payload capture needs an explicit mirror destination and a capture host.</span>
          <button className="secondary-button" onClick={() => void onRunPreset(["show monitor"])} type="button">
            <TerminalSquare size={16} />
            Mirror Status
          </button>
        </div>
      </section>
    </div>
  );
}

function countMacsByPort(entries: SwitchMacEntry[]) {
  const counts = new Map<number, number>();

  for (const entry of entries) {
    if (entry.portIndex == null) {
      continue;
    }

    counts.set(entry.portIndex, (counts.get(entry.portIndex) ?? 0) + 1);
  }

  return counts;
}

function buildPhysicalPortRows(ports: SwitchPort[]) {
  const sortedPorts = [...ports].sort((a, b) => a.index - b.index);
  return [sortedPorts.filter((port) => port.index % 2 === 1), sortedPorts.filter((port) => port.index % 2 === 0)];
}

function capacityBytesPerSecond(port: SwitchPort) {
  const speedMbps = port.maxSpeedMbps ?? port.speedMbps;
  return speedMbps == null ? undefined : (speedMbps * 1_000_000) / 8;
}

function formatMacCount(count: number) {
  return count === 1 ? "1 MAC" : `${count} MACs`;
}

function formatCompactStatus(status: SwitchPort["operStatus"]) {
  if (status === "down") {
    return "dn";
  }

  if (status === "testing") {
    return "test";
  }

  if (status === "unknown") {
    return "unk";
  }

  return status;
}
