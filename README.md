# Server Explorer

Standalone rack, server, cluster, and switch explorer for internal infrastructure. It now combines the former `procurve-modern` switch console with the rack and Harvester cluster explorer in one public source repo, one Docker image, and one Kubernetes deployment suitable for embedding in Assessorly Spiders.

## What It Does

- Renders the current one-switch/four-server rack by default: ProCurve 2810-24G, `r640`, `r510b`, `r510a`, and `r710`.
- Draws color-coded links for the configured physical/server paths.
- Provides search, status/category filters, a details inspector, and a compact event/alert feed.
- Includes the ProCurve switch console as a first-class tab: SNMP status, port state, live traffic rates, VLANs, LLDP neighbors, MAC table, config backup, and read-safe console command presets.
- Adds a cluster explorer tab for Harvester/Kubernetes inventory: nodes, pods, services, workloads, KubeVirt VMs, PVs/PVCs, storage classes, Longhorn nodes, disks, volumes, replicas, and engines.
- Shows realtime CPU, memory, filesystem, and disk-busy metrics through the Rancher/Grafana Prometheus datasource.
- Loads topology from a private JSON file at runtime; without one it falls back to the current rack inventory.
- Optionally runs simple HTTP/TCP reachability probes for configured targets.
- Sets a `frame-ancestors` content security policy so the app can be embedded in Spiders.

## What It Is Not

This is not a remote shell, IPMI/KVM control plane, scanner, or configuration writer. It does not expose SSH, Telnet, shell commands, or write operations. Keep credentials and private topology in runtime-mounted files or secrets, not in this public repository.

## Local Development

```sh
npm install
npm run dev:server
npm run dev
```

Open `http://localhost:5173`.

Useful environment:

```sh
PORT=3000
TOPOLOGY_FILE=/absolute/path/to/topology.json
PROBES_ENABLED=false
PROBE_TIMEOUT_MS=2500
SWITCH_HOST=192.168.1.193
SWITCH_LABEL=HP ProCurve 2810-24G
SNMP_COMMUNITY=
ALLOW_SWITCH_WRITE_COMMANDS=false
CLUSTER_EXPLORER_ENABLED=true
GRAFANA_URL=http://rancher-monitoring-grafana.cattle-monitoring-system.svc
PROMETHEUS_URL=http://rancher-monitoring-prometheus.cattle-monitoring-system.svc:9090
FRAME_ANCESTORS="'self' https://spiders.assessorly.com https://local.assessorly.com"
```

## Topology File

`TOPOLOGY_FILE` should point to JSON matching this rough shape:

```json
{
  "title": "Miles Rack Server Explorer",
  "site": "Harvester rack",
  "rack": { "label": "One switch / four server rack", "units": 42 },
  "devices": [
    {
      "id": "r640",
      "label": "r640",
      "category": "compute",
      "status": "online",
      "rackUnit": 34,
      "rackHeight": 1,
      "model": "Dell PowerEdge R640",
      "ip": "192.168.1.100",
      "ports": [{ "id": "lan", "label": "LAN / switch port 19", "kind": "network" }]
    }
  ],
  "links": [
    {
      "id": "switch-r640",
      "kind": "network",
      "from": { "deviceId": "procurve-2810", "portId": "port-19" },
      "to": { "deviceId": "r640", "portId": "lan" }
    }
  ]
}
```

## Production Build

```sh
npm run typecheck
npm run build
npm start
```

## Docker

```sh
docker buildx build --platform linux/amd64 -t ghcr.io/richardtmiles/server-explorer:latest .
```

## Kubernetes

The checked-in manifests deploy a single pod and expose it internally through NodePort `30094`.
They also define nginx ingress for `explorer.miles.systems` and `procurve.miles.systems` with TLS from cert-manager. `server-explorer.miles.systems` is kept as a compatibility alias. Private/LAN source ranges can open the app without a prompt; other source ranges must pass nginx Basic Auth through the `server-explorer-basic-auth` secret. The default deployment enables probes only for explicitly configured devices in the topology.

The cluster explorer uses the `server-explorer` service account and a read-only ClusterRole. It can list Kubernetes, KubeVirt, Longhorn, and storage resources, but it does not read secrets or mutate cluster state.

```sh
kubectl apply -k k8s
```

Create the Basic Auth secret from an `htpasswd` line. Do not commit the real password.

```sh
kubectl -n server-explorer create secret generic server-explorer-basic-auth \
  --from-literal=auth='rtm:$2y$05$replace-with-htpasswd-output'
```

Mount private topology with a config map or secret and set `TOPOLOGY_FILE=/config/topology.json`.

Create the switch SNMP secret in the `server-explorer` namespace using the read-only community string. Do not commit the real community string.

```sh
kubectl -n server-explorer create secret generic server-explorer-switch-secrets \
  --from-literal=snmp-community='replace-with-read-community'
```

## Security Notes

- Keep `PROBES_ENABLED=false` unless the deployment network path is intentionally allowed to probe configured hosts.
- The probe endpoint only supports HTTP(S) and TCP connect checks against explicitly configured device probe targets.
- Switch console write/config commands are blocked unless `ALLOW_SWITCH_WRITE_COMMANDS=true`; keep it false for the public embedded console.
- The app sets `Content-Security-Policy: frame-ancestors ...`; update `FRAME_ANCESTORS` if Spiders hostnames change.
- Keep public ingress behind nginx Basic Auth or stronger identity-aware auth.
