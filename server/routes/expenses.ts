import { Router } from 'express';
import { createHandler } from './handlers';
import { expensesResource } from '../validation/resources';
import { kampalaToday } from '../lib/dates';

export const expensesRouter = Router();

/** POST /api/expenses — date defaults to today in Africa/Kampala (Phase 0.9). */
expensesRouter.post('/', createHandler(expensesResource, {
  idPrefix: 'e',
  prepare: (data) => ({ ...data, date: data.date ?? kampalaToday() }),
}));
