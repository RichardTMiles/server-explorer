# Server Explorer

Standalone rack and server topology explorer for internal infrastructure. It is scoped like `procurve-modern`: public source, private runtime configuration, Docker image, Kubernetes manifests, and an ingress suitable for embedding in Assessorly Spiders.

## What It Does

- Renders a 42U rack view with servers, switches, storage, UPS, and out-of-rack upstream nodes.
- Draws color-coded links for network, management, storage, power, and KVM paths.
- Provides search, status/category filters, a details inspector, and a compact event/alert feed.
- Loads topology from a private JSON file at runtime with a safe sample topology as fallback.
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
FRAME_ANCESTORS="'self' https://spiders.assessorly.com https://local.assessorly.com"
```

## Topology File

`TOPOLOGY_FILE` should point to JSON matching this rough shape:

```json
{
  "title": "Server Type-A Config & Connectivity",
  "site": "Lab Rack",
  "rack": { "label": "42U Server Rack", "units": 42 },
  "devices": [
    {
      "id": "r640-01",
      "label": "Compute 01",
      "category": "compute",
      "status": "online",
      "rackUnit": 28,
      "rackHeight": 2,
      "model": "Dell PowerEdge R640",
      "ports": [{ "id": "mgmt", "label": "iDRAC", "kind": "management" }]
    }
  ],
  "links": [
    {
      "id": "mgmt-01",
      "kind": "management",
      "from": { "deviceId": "mgmt-switch" },
      "to": { "deviceId": "r640-01", "portId": "mgmt" }
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
They also define nginx ingress for `server-explorer.miles.systems` with TLS from cert-manager. Private/LAN source ranges can open the app without a prompt; other source ranges must pass nginx Basic Auth through the `server-explorer-basic-auth` secret.

```sh
kubectl apply -k k8s
```

Create the Basic Auth secret from an `htpasswd` line. Do not commit the real password.

```sh
kubectl -n server-explorer create secret generic server-explorer-basic-auth \
  --from-literal=auth='rtm:$2y$05$replace-with-htpasswd-output'
```

Mount private topology with a config map or secret and set `TOPOLOGY_FILE=/config/topology.json`.

## Security Notes

- Keep `PROBES_ENABLED=false` unless the deployment network path is intentionally allowed to probe configured hosts.
- The probe endpoint only supports HTTP(S) and TCP connect checks against explicitly configured device probe targets.
- The app sets `Content-Security-Policy: frame-ancestors ...`; update `FRAME_ANCESTORS` if Spiders hostnames change.
- Keep public ingress behind nginx Basic Auth or stronger identity-aware auth.
