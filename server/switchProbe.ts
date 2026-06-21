import net from "node:net";
import type { TcpProbe } from "./switchTypes.js";

const MANAGEMENT_PORTS = [
  { port: 22, name: "SSH" },
  { port: 23, name: "Telnet" },
  { port: 80, name: "HTTP" },
  { port: 443, name: "HTTPS" }
];

export async function probeTcpPort(host: string, port: number, name: string, timeoutMs = 1500): Promise<TcpProbe> {
  const started = Date.now();

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (probe: TcpProbe) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(probe);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({ port, name, open: true, latencyMs: Date.now() - started });
    });
    socket.once("timeout", () => {
      finish({ port, name, open: false, error: "timeout" });
    });
    socket.once("error", (error) => {
      finish({ port, name, open: false, error: error.message });
    });
  });
}

export function probeManagementPorts(host: string) {
  return Promise.all(MANAGEMENT_PORTS.map((entry) => probeTcpPort(host, entry.port, entry.name)));
}

export async function fetchHttpTitle(host: string, timeoutMs = 2500): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let html = "";
    const socket = net.createConnection({ host, port: 80 });
    const finish = (title?: string) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(title);
    };

    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      socket.write(`GET / HTTP/1.0\r\nHost: ${host}\r\nUser-Agent: server-explorer\r\nAccept: */*\r\n\r\n`);
    });
    socket.on("data", (chunk: string) => {
      html += chunk;
      const title = html.match(/<title>\s*([\s\S]*?)\s*<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
      if (title) {
        finish(title);
        return;
      }

      if (html.length > 4096) {
        finish();
      }
    });
    socket.on("close", () => {
      const title = html.match(/<title>\s*([\s\S]*?)\s*<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
      finish(title || undefined);
    });
    socket.on("timeout", () => finish());
    socket.on("error", () => finish());
  });
}
