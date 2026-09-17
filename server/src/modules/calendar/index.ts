export { calendarRouter } from './calendar.routes';
export {
  complete,
  discardTasksForPlot,
  generateTasksForPlot,
  getById,
  list,
  save,
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
