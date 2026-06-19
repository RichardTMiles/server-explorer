import type { ProbeResult, Topology } from "./types";

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let message = fallback;
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      message = `${fallback} (${response.status})`;
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function fetchTopology() {
  return readJson<Topology>(await fetch("/v1/topology"), "Failed to load topology.");
}

export async function probeDevice(deviceId: string) {
  return readJson<ProbeResult>(
    await fetch(`/v1/probe/${encodeURIComponent(deviceId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
    "Probe failed."
  );
}
