import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { config } from "./env.js";

type AnyObject = Record<string, unknown>;

type KubernetesList = {
  items?: AnyObject[];
};

type PrometheusVectorResponse = {
  status: string;
  data?: {
    resultType?: string;
    result?: Array<{
      metric?: Record<string, string>;
      value?: [number, string];
    }>;
  };
};

type RequestOptions = {
  headers?: Record<string, string>;
  ca?: string;
};

const serviceAccountTokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const serviceAccountCaPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

function asObject(value: unknown): AnyObject {
  return value && typeof value === "object" ? (value as AnyObject) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asArray(value: unknown): AnyObject[] {
  return Array.isArray(value) ? value.map(asObject) : [];
}

function metadata(resource: AnyObject) {
  return asObject(resource.metadata);
}

function spec(resource: AnyObject) {
  return asObject(resource.spec);
}

function status(resource: AnyObject) {
  return asObject(resource.status);
}

function resourceName(resource: AnyObject) {
  return asString(metadata(resource).name) ?? "unknown";
}

function resourceNamespace(resource: AnyObject) {
  return asString(metadata(resource).namespace) ?? "default";
}

function creationTimestamp(resource: AnyObject) {
  return asString(metadata(resource).creationTimestamp);
}

function labels(resource: AnyObject) {
  return asObject(metadata(resource).labels);
}

function ageMs(resource: AnyObject) {
  const timestamp = creationTimestamp(resource);
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Date.now() - parsed : undefined;
}

function conditionStatus(conditions: unknown, type: string) {
  return asArray(conditions).find((condition) => condition.type === type)?.status;
}

function readyCondition(resource: AnyObject) {
  return conditionStatus(status(resource).conditions, "Ready") === "True";
}

function nodeRoles(resource: AnyObject) {
  return Object.keys(labels(resource))
    .filter((key) => key.startsWith("node-role.kubernetes.io/"))
    .map((key) => key.replace("node-role.kubernetes.io/", "") || "role")
    .sort();
}

function internalIp(resource: AnyObject) {
  return asArray(status(resource).addresses).find((address) => address.type === "InternalIP")?.address as
    | string
    | undefined;
}

function owner(resource: AnyObject) {
  const ownerReference = asArray(metadata(resource).ownerReferences)[0];
  if (!ownerReference) return undefined;
  return [ownerReference.kind, ownerReference.name].filter(Boolean).join("/");
}

function sumRecordValues(record: unknown) {
  return Object.values(asObject(record)).reduce<number>((sum, value) => sum + (asNumber(value) ?? 0), 0);
}

function bytesToGiB(value: number | undefined) {
  if (value == null) return undefined;
  return value / 1024 ** 3;
}

function pct(used: number | undefined, total: number | undefined) {
  if (used == null || total == null || total <= 0) return undefined;
  return (used / total) * 100;
}

function addWarning(warnings: string[], message: string) {
  if (!warnings.includes(message)) warnings.push(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readFileIfExists(path: string) {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: options.headers,
        ca: options.ca,
        rejectUnauthorized: parsed.protocol === "https:" ? Boolean(options.ca) : undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`${response.statusCode ?? "unknown"} ${response.statusMessage ?? ""}: ${body.slice(0, 300)}`));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.setTimeout(5000, () => {
      request.destroy(new Error(`timeout requesting ${url}`));
    });
    request.on("error", reject);
    request.end();
  });
}

async function kubernetesClient() {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
  const baseUrl = config.kubernetesApiUrl || (host ? `https://${host}:${port}` : undefined);
  const token = config.kubernetesToken || (await readFileIfExists(config.kubernetesTokenPath ?? serviceAccountTokenPath));
  const ca = await readFileIfExists(config.kubernetesCaPath ?? serviceAccountCaPath);

  if (!baseUrl || !token) {
    return undefined;
  }

  const headers = {
    Authorization: `Bearer ${token.trim()}`,
    Accept: "application/json",
  };

  return {
    async list(path: string) {
      const payload = await requestJson<KubernetesList>(`${baseUrl}${path}`, { headers, ca });
      return payload.items ?? [];
    },
  };
}

async function safeList(
  client: Awaited<ReturnType<typeof kubernetesClient>>,
  path: string,
  warnings: string[],
  label: string
) {
  if (!client) {
    addWarning(warnings, "Kubernetes service account credentials are not available in this runtime.");
    return [];
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await client.list(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 3 && (message.includes("429 Too Many Requests") || message.includes("storage is (re)initializing"))) {
        await sleep(350 * attempt);
        continue;
      }
      addWarning(warnings, `${label}: ${message}`);
      return [];
    }
  }

  return [];
}

async function prometheusQuery(query: string, warnings: string[], label: string) {
  const url = `${config.prometheusUrl.replace(/\/$/, "")}/api/v1/query?query=${encodeURIComponent(query)}`;
  try {
    const payload = await requestJson<PrometheusVectorResponse>(url);
    if (payload.status !== "success") {
      addWarning(warnings, `${label}: Prometheus returned ${payload.status}`);
      return new Map<string, number>();
    }

    return new Map(
      (payload.data?.result ?? [])
        .map((result) => {
          const instance = result.metric?.instance;
          const value = result.value?.[1] ? Number(result.value[1]) : undefined;
          return instance && value != null && Number.isFinite(value) ? ([instance, value] as const) : undefined;
        })
        .filter(Boolean) as Array<readonly [string, number]>
    );
  } catch (error) {
    addWarning(warnings, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    return new Map<string, number>();
  }
}

function metricForNode(metrics: Map<string, number>, nodeIp?: string) {
  if (!nodeIp) return undefined;
  for (const [instance, value] of metrics) {
    if (instance.split(":")[0] === nodeIp) return value;
  }
  return undefined;
}

function podReadiness(resource: AnyObject) {
  const containerStatuses = asArray(status(resource).containerStatuses);
  const ready = containerStatuses.filter((container) => container.ready === true).length;
  const restarts = containerStatuses.reduce((sum, container) => sum + (asNumber(container.restartCount) ?? 0), 0);
  return {
    ready,
    total: containerStatuses.length,
    restarts,
  };
}

function workloadStatus(resource: AnyObject, kind: string) {
  const currentStatus = status(resource);
  return {
    kind,
    namespace: resourceNamespace(resource),
    name: resourceName(resource),
    desired: asNumber(spec(resource).replicas) ?? asNumber(currentStatus.desiredNumberScheduled),
    ready: asNumber(currentStatus.readyReplicas) ?? asNumber(currentStatus.numberReady) ?? asNumber(currentStatus.succeeded),
    available: asNumber(currentStatus.availableReplicas) ?? asNumber(currentStatus.updatedNumberScheduled),
    ageMs: ageMs(resource),
  };
}

function longhornDiskRows(node: AnyObject) {
  const diskSpec = asObject(spec(node).disks);
  const diskStatus = asObject(status(node).diskStatus);

  return Object.entries({ ...diskSpec, ...diskStatus }).map(([id]) => {
    const currentSpec = asObject(diskSpec[id]);
    const currentStatus = asObject(diskStatus[id]);
    const maximum = asNumber(currentStatus.storageMaximum);
    const available = asNumber(currentStatus.storageAvailable);
    const scheduled = sumRecordValues(currentStatus.scheduledReplica);
    const ready = conditionStatus(currentStatus.conditions, "Ready") === "True";
    const schedulable = conditionStatus(currentStatus.conditions, "Schedulable") === "True";

    return {
      id,
      path: asString(currentSpec.path),
      allowScheduling: currentSpec.allowScheduling !== false,
      ready,
      schedulable,
      storageMaximumBytes: maximum,
      storageAvailableBytes: available,
      scheduledReplicaBytes: scheduled,
      usedPct: pct(maximum != null && available != null ? maximum - available : undefined, maximum),
      scheduledPct: pct(scheduled, maximum),
      conditions: asArray(currentStatus.conditions).map((condition) => ({
        type: asString(condition.type) ?? "Unknown",
        status: asString(condition.status) ?? "Unknown",
        reason: asString(condition.reason),
        message: asString(condition.message),
      })),
    };
  });
}

export async function loadClusterOverview() {
  const warnings: string[] = [];
  const client = await kubernetesClient();

  const [
    namespaces,
    nodes,
    pods,
    services,
    persistentVolumes,
    persistentVolumeClaims,
    deployments,
    statefulSets,
    daemonSets,
    replicaSets,
    jobs,
    cronJobs,
    virtualMachines,
    virtualMachineInstances,
    storageClasses,
  ] = await Promise.all([
    safeList(client, "/api/v1/namespaces", warnings, "namespaces"),
    safeList(client, "/api/v1/nodes", warnings, "nodes"),
    safeList(client, "/api/v1/pods", warnings, "pods"),
    safeList(client, "/api/v1/services", warnings, "services"),
    safeList(client, "/api/v1/persistentvolumes", warnings, "persistent volumes"),
    safeList(client, "/api/v1/persistentvolumeclaims", warnings, "persistent volume claims"),
    safeList(client, "/apis/apps/v1/deployments", warnings, "deployments"),
    safeList(client, "/apis/apps/v1/statefulsets", warnings, "stateful sets"),
    safeList(client, "/apis/apps/v1/daemonsets", warnings, "daemon sets"),
    safeList(client, "/apis/apps/v1/replicasets", warnings, "replica sets"),
    safeList(client, "/apis/batch/v1/jobs", warnings, "jobs"),
    safeList(client, "/apis/batch/v1/cronjobs", warnings, "cron jobs"),
    safeList(client, "/apis/kubevirt.io/v1/virtualmachines", warnings, "virtual machines"),
    safeList(client, "/apis/kubevirt.io/v1/virtualmachineinstances", warnings, "virtual machine instances"),
    safeList(client, "/apis/storage.k8s.io/v1/storageclasses", warnings, "storage classes"),
  ]);

  const longhornNodes = await safeList(client, "/apis/longhorn.io/v1beta2/nodes", warnings, "longhorn nodes");
  const longhornVolumes = await safeList(client, "/apis/longhorn.io/v1beta2/volumes", warnings, "longhorn volumes");
  const longhornReplicas = await safeList(client, "/apis/longhorn.io/v1beta2/replicas", warnings, "longhorn replicas");
  const longhornEngines = await safeList(client, "/apis/longhorn.io/v1beta2/engines", warnings, "longhorn engines");

  const [cpuUsageByInstance, memoryUsageByInstance, rootFsUsageByInstance, diskBusyByInstance] = await Promise.all([
    prometheusQuery('100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))', warnings, "node cpu"),
    prometheusQuery(
      "100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))",
      warnings,
      "node memory"
    ),
    prometheusQuery(
      '100 * (1 - (node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}))',
      warnings,
      "node root filesystem"
    ),
    prometheusQuery(
      'max by (instance) (100 * rate(node_disk_io_time_seconds_total{device!~"loop.*|ram.*"}[5m]))',
      warnings,
      "node disk busy"
    ),
  ]);

  const vmiByKey = new Map<string, AnyObject>(
    virtualMachineInstances.map((vmi) => [`${resourceNamespace(vmi)}/${resourceName(vmi)}`, vmi] as const)
  );
  const longhornNodeByName = new Map(longhornNodes.map((node) => [resourceName(node), node] as const));
  const longhornDisks = longhornNodes.flatMap((node) =>
    longhornDiskRows(node).map((disk) => ({
      ...disk,
      node: resourceName(node),
    }))
  );

  const nodeRows = nodes.map((node) => {
    const ip = internalIp(node);
    const longhornNode = longhornNodeByName.get(resourceName(node));
    const disks = longhornNode ? longhornDiskRows(longhornNode) : [];

    return {
      name: resourceName(node),
      status: readyCondition(node) ? "Ready" : "NotReady",
      roles: nodeRoles(node),
      internalIp: ip,
      osImage: asString(asObject(status(node).nodeInfo).osImage),
      kernelVersion: asString(asObject(status(node).nodeInfo).kernelVersion),
      kubeletVersion: asString(asObject(status(node).nodeInfo).kubeletVersion),
      ageMs: ageMs(node),
      metrics: {
        cpuUsagePct: metricForNode(cpuUsageByInstance, ip),
        memoryUsagePct: metricForNode(memoryUsageByInstance, ip),
        rootFsUsagePct: metricForNode(rootFsUsageByInstance, ip),
        diskBusyPct: metricForNode(diskBusyByInstance, ip),
      },
      longhorn: longhornNode
        ? {
            allowScheduling: spec(longhornNode).allowScheduling !== false,
            disks,
          }
        : undefined,
    };
  });

  const podRows = pods.map((pod) => {
    const readiness = podReadiness(pod);
    return {
      namespace: resourceNamespace(pod),
      name: resourceName(pod),
      phase: asString(status(pod).phase) ?? "Unknown",
      nodeName: asString(spec(pod).nodeName),
      podIp: asString(status(pod).podIP),
      ready: readiness.ready,
      total: readiness.total,
      restarts: readiness.restarts,
      owner: owner(pod),
      ageMs: ageMs(pod),
    };
  });

  const serviceRows = services.map((service) => {
    const serviceSpec = spec(service);
    return {
      namespace: resourceNamespace(service),
      name: resourceName(service),
      type: asString(serviceSpec.type) ?? "ClusterIP",
      clusterIp: asString(serviceSpec.clusterIP),
      externalIps: Array.isArray(serviceSpec.externalIPs) ? serviceSpec.externalIPs : [],
      ports: asArray(serviceSpec.ports).map((port) => ({
        name: asString(port.name),
        port: asNumber(port.port),
        protocol: asString(port.protocol),
        nodePort: asNumber(port.nodePort),
      })),
      ageMs: ageMs(service),
    };
  });

  const vmRows = virtualMachines.map((vm) => {
    const key = `${resourceNamespace(vm)}/${resourceName(vm)}`;
    const vmi = vmiByKey.get(key);
    const vmStatus = status(vm);
    const vmiStatus = vmi ? status(vmi) : {};
    const vmSpec = spec(vm);
    const templateSpec = asObject(asObject(vmSpec.template).spec);
    const domain = asObject(templateSpec.domain);
    const resources = asObject(asObject(domain.resources).requests);

    return {
      namespace: resourceNamespace(vm),
      name: resourceName(vm),
      running: vmSpec.running === true || asString(vmStatus.printableStatus)?.toLowerCase() === "running",
      printableStatus: asString(vmStatus.printableStatus) ?? asString(vmiStatus.phase) ?? "Unknown",
      nodeName: asString(vmiStatus.nodeName),
      ip: asString(asArray(vmiStatus.interfaces)[0]?.ipAddress),
      cpu: asObject(domain.cpu).cores,
      memory: resources.memory,
      volumes: asArray(templateSpec.volumes).map((volume) => volume.name).filter(Boolean),
      ageMs: ageMs(vm),
    };
  });

  const longhornVolumeRows = longhornVolumes.map((volume) => {
    const currentStatus = status(volume);
    return {
      namespace: resourceNamespace(volume),
      name: resourceName(volume),
      state: asString(currentStatus.state),
      robustness: asString(currentStatus.robustness),
      nodeId: asString(currentStatus.currentNodeID),
      sizeBytes: asNumber(spec(volume).size),
      actualSizeBytes: asNumber(currentStatus.actualSize),
      frontend: asString(spec(volume).frontend),
      numberOfReplicas: asNumber(spec(volume).numberOfReplicas),
      ageMs: ageMs(volume),
    };
  });

  const workloads = [
    ...deployments.map((resource) => workloadStatus(resource, "Deployment")),
    ...statefulSets.map((resource) => workloadStatus(resource, "StatefulSet")),
    ...daemonSets.map((resource) => workloadStatus(resource, "DaemonSet")),
    ...replicaSets.map((resource) => workloadStatus(resource, "ReplicaSet")),
    ...jobs.map((resource) => workloadStatus(resource, "Job")),
    ...cronJobs.map((resource) => workloadStatus(resource, "CronJob")),
  ];

  return {
    updatedAt: new Date().toISOString(),
    source: {
      kubernetes: client ? "in-cluster service account" : "unavailable",
      grafanaUrl: config.grafanaUrl,
      prometheusUrl: config.prometheusUrl,
      metrics: "Rancher monitoring Prometheus datasource used by Grafana",
    },
    warnings,
    summary: {
      namespaces: namespaces.length,
      nodes: nodes.length,
      pods: pods.length,
      runningPods: podRows.filter((pod) => pod.phase === "Running").length,
      services: services.length,
      workloads: workloads.length,
      virtualMachines: virtualMachines.length,
      runningVirtualMachines: vmRows.filter((vm) => vm.running).length,
      persistentVolumes: persistentVolumes.length,
      persistentVolumeClaims: persistentVolumeClaims.length,
      storageClasses: storageClasses.length,
      longhornVolumes: longhornVolumes.length,
      healthyLonghornVolumes: longhornVolumeRows.filter((volume) => volume.robustness === "healthy").length,
      longhornReplicas: longhornReplicas.length,
      longhornEngines: longhornEngines.length,
      longhornDisks: longhornDisks.length,
      readyLonghornDisks: longhornDisks.filter((disk) => disk.ready).length,
    },
    nodes: nodeRows,
    pods: podRows,
    services: serviceRows,
    workloads,
    virtualMachines: vmRows,
    storage: {
      persistentVolumes: persistentVolumes.map((pv) => ({
        name: resourceName(pv),
        phase: asString(status(pv).phase),
        capacity: asObject(spec(pv).capacity).storage,
        storageClassName: asString(spec(pv).storageClassName),
        claim: asObject(spec(pv).claimRef),
        ageMs: ageMs(pv),
      })),
      persistentVolumeClaims: persistentVolumeClaims.map((pvc) => ({
        namespace: resourceNamespace(pvc),
        name: resourceName(pvc),
        phase: asString(status(pvc).phase),
        capacity: asObject(status(pvc).capacity).storage,
        storageClassName: asString(spec(pvc).storageClassName),
        volumeName: asString(spec(pvc).volumeName),
        ageMs: ageMs(pvc),
      })),
      storageClasses: storageClasses.map((storageClass) => ({
        name: resourceName(storageClass),
        provisioner: asString(storageClass.provisioner),
        reclaimPolicy: asString(storageClass.reclaimPolicy),
        volumeBindingMode: asString(storageClass.volumeBindingMode),
      })),
      longhorn: {
        nodes: longhornNodes.map((node) => ({
          name: resourceName(node),
          allowScheduling: spec(node).allowScheduling !== false,
          disks: longhornDiskRows(node),
        })),
        disks: longhornDisks,
        volumes: longhornVolumeRows,
      },
    },
    totals: {
      longhornStorageMaximumGiB: bytesToGiB(
        longhornDisks.reduce((sum, disk) => sum + (disk.storageMaximumBytes ?? 0), 0)
      ),
      longhornStorageAvailableGiB: bytesToGiB(
        longhornDisks.reduce((sum, disk) => sum + (disk.storageAvailableBytes ?? 0), 0)
      ),
      longhornScheduledReplicaGiB: bytesToGiB(
        longhornDisks.reduce((sum, disk) => sum + (disk.scheduledReplicaBytes ?? 0), 0)
      ),
    },
  };
}
