import net from "node:net";
import type { TopologyDevice } from "./topology.js";

export type ProbeResult = {
  ok: boolean;
  kind: "http" | "tcp";
  target: string;
  elapsedMs: number;
  status?: number;
  error?: string;
};

const timeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timeout),
  };
};

async function probeHttp(url: string, timeoutMs: number): Promise<ProbeResult> {
  const started = Date.now();
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: timeout.signal,
    });
    return {
      ok: response.status >= 200 && response.status < 500,
      kind: "http",
      target: url,
      elapsedMs: Date.now() - started,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      kind: "http",
      target: url,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    timeout.done();
  }
}

async function probeTcp(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  const started = Date.now();
  const target = `${host}:${port}`;

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: ProbeResult) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({
        ok: true,
        kind: "tcp",
        target,
        elapsedMs: Date.now() - started,
      });
    });
    socket.once("timeout", () => {
      finish({
        ok: false,
        kind: "tcp",
        target,
        elapsedMs: Date.now() - started,
        error: "timeout",
      });
    });
    socket.once("error", (error) => {
      finish({
        ok: false,
        kind: "tcp",
        target,
        elapsedMs: Date.now() - started,
        error: error.message,
      });
    });
  });
}

export async function probeDevice(device: TopologyDevice, timeoutMs: number) {
  if (!device.probe) {
    return null;
  }

  if (device.probe.kind === "http") {
    return probeHttp(device.probe.url, timeoutMs);
  }

  return probeTcp(device.probe.host, device.probe.port, timeoutMs);
}
