export { healthRouter } from './health.routes';
export {
  getLiveness,
  getReadiness,
  type LivenessReport,
  type ReadinessReport,
  type DependencyReport,
} from './health.service';
