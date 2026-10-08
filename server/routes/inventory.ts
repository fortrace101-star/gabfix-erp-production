import { Router } from 'express';
import { createHandler, updateHandler } from './handlers';
import { inventoryResource } from '../validation/resources';

/** Defaults applied when the form leaves a field blank. */
const withDefaults = (data: Record<string, unknown>) => ({
  ...data,
  unit: data.unit ?? 'unit',
  quantity: data.quantity ?? 0,
  minimum: data.minimum ?? 0,
  cost: data.cost ?? 0,
});

export const inventoryRouter = Router();

/** POST /api/inventory */
inventoryRouter.post('/', createHandler(inventoryResource, { idPrefix: 'i', prepare: withDefaults }));

/** PATCH /api/inventory/:id — stock movements post `quantity`; other fields 422. */
inventoryRouter.patch('/:id', updateHandler(inventoryResource, { notFound: 'Inventory item not found', label: 'inventory update' }));
