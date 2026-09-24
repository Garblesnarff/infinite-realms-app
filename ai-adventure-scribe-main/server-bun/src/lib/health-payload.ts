import { resolveImageModel } from './image-model.js';
import { getModelHealthStatus } from '../services/model-health.js';

export interface HealthPayload {
  status: ReturnType<typeof getModelHealthStatus>['status'];
  timestamp: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  modelHealth: ReturnType<typeof getModelHealthStatus>;
  imageModel: string;
}

/** Body of GET /health. Kept out of app.ts so it can be tested without booting the app. */
export function buildHealthPayload(): HealthPayload {
  const modelHealth = getModelHealthStatus();
  return {
    status: modelHealth.status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    modelHealth,
    // #2201: effective image model name only (env value or code default).
    imageModel: resolveImageModel(),
  };
}
