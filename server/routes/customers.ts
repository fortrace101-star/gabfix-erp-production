import { Router } from 'express';
import { createHandler, updateHandler } from './handlers';
import { customersResource } from '../validation/resources';

export const customersRouter = Router();

/** POST /api/customers */
customersRouter.post('/', createHandler(customersResource, { idPrefix: 'c' }));

/** PATCH /api/customers/:id — admin customer edit modal. */
customersRouter.patch('/:id', updateHandler(customersResource, {
  notFound: 'Customer not found',
  label: 'customer',
}));
