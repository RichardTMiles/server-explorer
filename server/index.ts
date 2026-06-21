import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config } from "./env.js";
import { loadClusterOverview } from "./cluster.js";
import { findDevice, loadTopology } from "./topology.js";
import { probeDevice } from "./probe.js";
import { runCli } from "./switchCli.js";
import { fetchHttpTitle, probeManagementPorts } from "./switchProbe.js";
import { getMacTable, getNeighbors, getPorts, getSystemInfo, getVlans } from "./switchSnmp.js";
import type { CliRequest, ServiceConfig, SystemInfo } from "./switchTypes.js";

const app = express();
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(runtimeDir, "..", "..");
const clientDistDir = path.resolve(projectRoot, "dist", "client");

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

const switchConfig: ServiceConfig = {
  port: config.port,
  switchHost: config.switchHost,
  switchLabel: config.switchLabel,
  snmpCommunity: config.snmpCommunity,
  allowWriteCommands: config.allowSwitchWriteCommands,
};

const cliRequestSchema = z.object({
  transport: z.enum(["ssh", "telnet"]),
  username: z.string().optional(),
  password: z.string().optional(),
  commands: z.array(z.string().min(1)).min(1).max(20),
  timeoutMs: z.number().int().min(3000).max(120000).optional(),
});

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self' data:",
      `frame-ancestors ${config.frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  next();
});

app.get("/v1/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "server-explorer",
    topologyFile: Boolean(config.topologyFile),
    probesEnabled: config.probesEnabled,
    switchHost: config.switchHost,
    switchSnmpConfigured: Boolean(config.snmpCommunity),
    switchWriteCommandsEnabled: config.allowSwitchWriteCommands,
    clusterExplorerEnabled: config.clusterExplorerEnabled,
  });
});

app.get("/v1/topology", async (_req, res, next) => {
  try {
    res.json(await loadTopology(config.topologyFile));
  } catch (error) {
    next(error);
  }
});

app.get("/v1/cluster", async (_req, res, next) => {
  try {
    if (!config.clusterExplorerEnabled) {
      res.status(503).json({ error: "Cluster explorer is disabled for this deployment." });
      return;
    }

    res.json(await loadClusterOverview());
  } catch (error) {
    next(error);
  }
});

app.get("/v1/switch/status", async (_req, res, next) => {
  try {
    const [managementPorts, snmpInfo, httpTitle] = await Promise.all([
      probeManagementPorts(switchConfig.switchHost),
      getSystemInfo(switchConfig),
      fetchHttpTitle(switchConfig.switchHost),
    ]);

    const payload: SystemInfo = {
      host: switchConfig.switchHost,
      label: switchConfig.switchLabel,
      ...snmpInfo,
      httpTitle,
      managementPorts,
      snmpEnabled: Boolean(snmpInfo.snmpEnabled),
      writeCommandsEnabled: switchConfig.allowWriteCommands,
    };

    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/v1/switch/ports", async (_req, res, next) => {
  try {
    res.json(await getPorts(switchConfig));
  } catch (error) {
    next(error);
  }
});

app.get("/v1/switch/vlans", async (_req, res, next) => {
  try {
    res.json(await getVlans(switchConfig));
  } catch (error) {
    next(error);
  }
});

app.get("/v1/switch/neighbors", async (_req, res, next) => {
  try {
    res.json(await getNeighbors(switchConfig));
  } catch (error) {
    next(error);
  }
});

app.get("/v1/switch/mac-table", async (_req, res, next) => {
  try {
    res.json(await getMacTable(switchConfig));
  } catch (error) {
    next(error);
  }
});

app.post("/v1/switch/cli", async (req, res, next) => {
  try {
    const cliRequest: CliRequest = cliRequestSchema.parse(req.body);
    res.json(await runCli(switchConfig, cliRequest));
  } catch (error) {
    next(error);
  }
});

app.post("/v1/switch/backup", async (req, res, next) => {
  try {
    const cliRequest = cliRequestSchema.omit({ commands: true }).parse(req.body);
    res.json(
      await runCli(switchConfig, {
        ...cliRequest,
        commands: ["show running-config"],
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post("/v1/probe/:deviceId", async (req, res, next) => {
  try {
    if (!config.probesEnabled) {
      res.status(403).json({ error: "Probes are disabled for this deployment." });
      return;
    }

    const topology = await loadTopology(config.topologyFile);
    const device = findDevice(topology, req.params.deviceId);
    if (!device) {
      res.status(404).json({ error: "Device not found." });
      return;
    }

    const result = await probeDevice(device, config.probeTimeoutMs);
    if (!result) {
      res.status(400).json({ error: "Device has no configured probe target." });
      return;
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use(
  express.static(clientDistDir, {
    index: false,
  })
);

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/v1")) return next();
  res.sendFile(path.join(clientDistDir, "index.html"));
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("request failed", err);
  res.status(err instanceof z.ZodError ? 400 : 500).json({
    error: err instanceof Error ? err.message : "Internal Server Error",
  });
});

app.listen(config.port, () => {
  console.log(`server-explorer listening on :${config.port}`);
});
