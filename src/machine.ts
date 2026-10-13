import os from 'node:os';

/**
 * Identifies the hardware results were measured on. Shared CI runners hand
 * out machines with different CPUs, which shifts every benchmark at once, so
 * results are only compared when this matches.
 */
export function machineId(mode: 'time' | 'instructions' = 'time'): string {
  // Instruction counts only depend on the architecture.
  if (mode === 'instructions') return `instruction counts · ${process.platform}-${process.arch}`;
  const cpus = os.cpus();
  const model = (cpus[0]?.model ?? 'unknown CPU').replace(/\s+/g, ' ').trim();
  return `${model} · ${cpus.length} cores · ${process.platform}-${process.arch}`;
}
