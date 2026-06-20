const readNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readBoolean = (value: string | undefined, fallback: boolean) => {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export const config = {
  port: readNumber(process.env.PORT, 3000),
  topologyFile: process.env.TOPOLOGY_FILE?.trim() || undefined,
  probesEnabled: readBoolean(process.env.PROBES_ENABLED, false),
  probeTimeoutMs: Math.max(250, readNumber(process.env.PROBE_TIMEOUT_MS, 2500)),
  clusterExplorerEnabled: readBoolean(process.env.CLUSTER_EXPLORER_ENABLED, true),
  kubernetesApiUrl: process.env.KUBERNETES_API_URL?.trim() || undefined,
  kubernetesToken: process.env.KUBERNETES_TOKEN?.trim() || undefined,
  kubernetesTokenPath: process.env.KUBERNETES_TOKEN_PATH?.trim() || undefined,
  kubernetesCaPath: process.env.KUBERNETES_CA_PATH?.trim() || undefined,
  grafanaUrl:
    process.env.GRAFANA_URL?.trim() || "http://rancher-monitoring-grafana.cattle-monitoring-system.svc",
  prometheusUrl:
    process.env.PROMETHEUS_URL?.trim() ||
    "http://rancher-monitoring-prometheus.cattle-monitoring-system.svc:9090",
  frameAncestors:
    process.env.FRAME_ANCESTORS?.trim() ||
    "'self' https://spiders.assessorly.com https://spiders-staging.assessorly.com https://local.assessorly.com",
};
