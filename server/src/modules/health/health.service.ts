import { getDatabaseStatus, pingDatabase, type DatabaseStatus } from '@config';
import { isDraining } from '@shared';

export interface LivenessReport {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
  version: string;
}

export interface DependencyReport {
  status: 'up' | 'down';
  detail: DatabaseStatus;
  latencyMs?: number;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  timestamp: string;
  draining: boolean;
  checks: {
    mongodb: DependencyReport;
  };
}

const VERSION = process.env.npm_package_version ?? '0.0.0';

/** Liveness: is the process itself healthy? Never touches dependencies. */
export function getLiveness(): LivenessReport {
  return {
    status: 'ok',
    uptimeSeconds: Number(process.uptime().toFixed(3)),
    timestamp: new Date().toISOString(),
    version: VERSION,
  };
}

/** Readiness: can this instance actually serve traffic right now? */
export async function getReadiness(): Promise<ReadinessReport> {
  const startedAt = process.hrtime.bigint();
  const reachable = await pingDatabase();
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const mongodb: DependencyReport = {
    status: reachable ? 'up' : 'down',
    detail: getDatabaseStatus(),
    latencyMs: Number(latencyMs.toFixed(2)),
  };

  // A draining instance must be pulled from the load balancer even while its
  // dependencies are still healthy.
  const ready = reachable && !isDraining();

  return {
    status: ready ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    draining: isDraining(),
    checks: { mongodb },
  };
}
