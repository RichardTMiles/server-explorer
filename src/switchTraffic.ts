import type { SwitchPort } from "./switchTypes";

export type PortRate = {
  inBytesPerSecond?: number;
  outBytesPerSecond?: number;
  totalBytesPerSecond?: number;
  utilizationPercent?: number;
  sampleSeconds?: number;
};

export type PortRateSample = {
  timestamp: number;
  inOctets?: number;
  outOctets?: number;
};

export type PortRateMap = Record<number, PortRate>;

export function calculatePortRates(previousSamples: Map<number, PortRateSample>, ports: SwitchPort[], timestamp: number): PortRateMap {
  const rates: PortRateMap = {};

  for (const port of ports) {
    const previous = previousSamples.get(port.index);
    if (!previous) {
      continue;
    }

    const sampleSeconds = Math.max((timestamp - previous.timestamp) / 1000, 0);
    if (sampleSeconds < 1) {
      continue;
    }

    const inDelta = counterDelta(previous.inOctets, port.inOctets);
    const outDelta = counterDelta(previous.outOctets, port.outOctets);
    const inBytesPerSecond = inDelta == null ? undefined : inDelta / sampleSeconds;
    const outBytesPerSecond = outDelta == null ? undefined : outDelta / sampleSeconds;
    const totalBytesPerSecond = (inBytesPerSecond ?? 0) + (outBytesPerSecond ?? 0);
    const linkBitsPerSecond = port.maxSpeedMbps ? port.maxSpeedMbps * 1_000_000 : port.speedMbps ? port.speedMbps * 1_000_000 : undefined;
    const directionalBytesPerSecond = Math.max(inBytesPerSecond ?? 0, outBytesPerSecond ?? 0);
    const utilizationPercent = linkBitsPerSecond ? Math.min((directionalBytesPerSecond * 8 * 100) / linkBitsPerSecond, 100) : undefined;

    rates[port.index] = {
      inBytesPerSecond,
      outBytesPerSecond,
      totalBytesPerSecond,
      utilizationPercent,
      sampleSeconds
    };
  }

  return rates;
}

export function sumPortRates(ports: SwitchPort[], portRates: PortRateMap): PortRate {
  return ports.reduce<PortRate>(
    (total, port) => {
      const rate = portRates[port.index];
      return {
        inBytesPerSecond: (total.inBytesPerSecond ?? 0) + (rate?.inBytesPerSecond ?? 0),
        outBytesPerSecond: (total.outBytesPerSecond ?? 0) + (rate?.outBytesPerSecond ?? 0),
        totalBytesPerSecond: (total.totalBytesPerSecond ?? 0) + (rate?.totalBytesPerSecond ?? 0)
      };
    },
    { inBytesPerSecond: undefined, outBytesPerSecond: undefined, totalBytesPerSecond: undefined }
  );
}

export function formatRate(bytesPerSecond: number | undefined) {
  if (bytesPerSecond == null) {
    return "Sampling";
  }

  const bitsPerSecond = Math.max(bytesPerSecond * 8, 0);
  const units = ["b/s", "Kb/s", "Mb/s", "Gb/s"];
  let value = bitsPerSecond;
  let unit = units[0] ?? "b/s";

  for (const nextUnit of units) {
    unit = nextUnit;
    if (value < 1000 || nextUnit === units.at(-1)) {
      break;
    }
    value /= 1000;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function formatLineRate(speedMbps: number | undefined) {
  if (speedMbps == null) {
    return "Unknown";
  }

  if (speedMbps >= 1000) {
    return `${formatCompact(speedMbps / 1000)} Gb/s`;
  }

  return `${formatCompact(speedMbps)} Mb/s`;
}

export function formatDuplexRate(speedMbps: number | undefined) {
  return speedMbps == null ? "Unknown" : formatLineRate(speedMbps * 2);
}

export function formatPercent(value: number | undefined) {
  if (value == null) {
    return "Sampling";
  }

  if (value < 0.1 && value > 0) {
    return "<0.1%";
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatCompact(value: number) {
  return value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function counterDelta(previous: number | undefined, current: number | undefined) {
  if (previous == null || current == null) {
    return undefined;
  }

  if (current >= previous) {
    return current - previous;
  }

  return current + 2 ** 32 - previous;
}
