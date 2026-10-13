import os from 'node:os';

/**
 * Identifies the hardware results were measured on. Shared CI runners hand
 * out machines with different CPUs, which shifts every benchmark at once, so
 * results are only compared when this matches.
 */
export function machineId(): string {
  const cpus = os.cpus();
  const model = (cpus[0]?.model ?? 'unknown CPU').replace(/\s+/g, ' ').trim();
  return `${model} · ${cpus.length} cores · ${process.platform}-${process.arch}`;
}
