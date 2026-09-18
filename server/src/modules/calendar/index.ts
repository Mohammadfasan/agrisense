export { calendarRouter, plotCalendarRouter } from './calendar.routes';
export { generateForPlot, type GenerateResult } from './calendarGeneration.service';
export {
  today,
  pipeline as todayPipeline,
  type TodayBuckets,
  type TodayTask,
} from './calendarToday.service';
export {
  complete,
  discardTasksForPlot,
  generateTasksForPlot,
  getById,
  list,
  save,
  setStatus,
  softDelete,
  syncTemplateTasks,
  upcoming,
  update,
  type SaveResult,
} from './calendarTask.service';
export {
  CROP_CALENDAR_VERSION,
  templateFor,
  type CropActivity,
  type CropCalendarTemplate,
} from './cropCalendar.templates';
