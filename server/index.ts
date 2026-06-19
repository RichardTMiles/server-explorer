import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./env.js";
import { findDevice, loadTopology } from "./topology.js";
import { probeDevice } from "./probe.js";

const app = express();
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(runtimeDir, "..", "..");
const clientDistDir = path.resolve(projectRoot, "dist", "client");

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

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
  });
});

app.get("/v1/topology", async (_req, res, next) => {
  try {
    res.json(await loadTopology(config.topologyFile));
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
  res.status(500).json({
    error: err instanceof Error ? err.message : "Internal Server Error",
  });
});

app.listen(config.port, () => {
  console.log(`server-explorer listening on :${config.port}`);
});
