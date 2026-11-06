import { Router } from 'express';
import { bomCostingRoutes } from './bom-costing';

export const bomRoutes = Router();
bomRoutes.use('/', bomCostingRoutes);
