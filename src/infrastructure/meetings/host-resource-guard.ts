import { readFile } from "node:fs/promises";
import { availableParallelism, loadavg } from "node:os";

export type HostCapacityLimits = {
  /** Memória disponível mínima no host (MB) para começar uma transcrição local. */
  minAvailableMemoryMb: number;
  /** Pressão (PSI, % do tempo com tarefas esperando nos últimos 10 s) acima da qual a transcrição espera. */
  maxCpuPressurePct: number;
  maxMemoryPressurePct: number;
  /** Carga média de 1 min por CPU. */
  maxLoadPerCpu: number;
};

export type HostCapacityVerdict = { ok: true } | { ok: false; reason: string };

type HostReaders = { read: (path: string) => Promise<string>; loadavg: () => number[]; cpus: () => number };
const defaultReaders: HostReaders = { read: (path) => readFile(path, "utf8"), loadavg, cpus: availableParallelism };

/**
 * Antes de iniciar uma transcrição local (pesada), confere se o host tem folga. Sem folga, o job fica
 * na fila e o worker tenta depois — a API, o banco, o WhatsApp e as gravações nunca disputam CPU/RAM
 * com o modelo. Fora do Linux (sem /proc), só a carga média é considerada.
 */
export async function checkHostCapacity(limits: HostCapacityLimits, readers: HostReaders = defaultReaders): Promise<HostCapacityVerdict> {
  const meminfo = await readers.read("/proc/meminfo").catch(() => "");
  const available = /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo);
  if (available) {
    const mb = Math.round(Number(available[1]) / 1024);
    if (mb < limits.minAvailableMemoryMb) return { ok: false, reason: `memória disponível ${mb} MB < ${limits.minAvailableMemoryMb} MB` };
  }
  for (const [resource, limit] of [["cpu", limits.maxCpuPressurePct], ["memory", limits.maxMemoryPressurePct]] as const) {
    const pressure = /^some avg10=([\d.]+)/m.exec(await readers.read(`/proc/pressure/${resource}`).catch(() => ""));
    if (pressure && Number(pressure[1]) > limit) return { ok: false, reason: `pressão de ${resource === "cpu" ? "CPU" : "memória"} ${pressure[1]}% > ${limit}%` };
  }
  const load = (readers.loadavg()[0] ?? 0) / Math.max(1, readers.cpus());
  if (load > limits.maxLoadPerCpu) return { ok: false, reason: `carga ${load.toFixed(2)} por CPU > ${limits.maxLoadPerCpu}` };
  return { ok: true };
}
