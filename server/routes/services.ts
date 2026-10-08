import { Router } from 'express';
import { createHandler } from './handlers';
import { servicesResource } from '../validation/resources';

export const servicesRouter = Router();

/** POST /api/services */
servicesRouter.post('/', createHandler(servicesResource, { idPrefix: 's' }));
