import { Router } from 'express';
import { createHandler, updateHandler } from './handlers';
import { equipmentResource } from '../validation/resources';
import { addDays, kampalaToday } from '../lib/dates';

/** New assets assume a 90-day maintenance window. */
const DEFAULT_MAINTENANCE_DAYS = 90;

/** Defaults applied when the form leaves a field blank. */
const withDefaults = (data: Record<string, unknown>) => ({
  ...data,
  bookValue: data.bookValue ?? data.value,
  condition: data.condition ?? 'Good',
  nextMaintenance: data.nextMaintenance ?? addDays(kampalaToday(), DEFAULT_MAINTENANCE_DAYS),
  usage: data.usage ?? 0,
});

export const equipmentRouter = Router();

/** POST /api/equipment */
equipmentRouter.post('/', createHandler(equipmentResource, { idPrefix: 'a', prepare: withDefaults }));

/** PATCH /api/equipment/:id — book value, condition, usage, next maintenance. */
equipmentRouter.patch('/:id', updateHandler(equipmentResource, { notFound: 'Equipment not found', label: 'equipment update' }));
