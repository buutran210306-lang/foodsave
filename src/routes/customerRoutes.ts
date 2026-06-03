import { Router } from "express";
import { customerController } from "../controllers/customerController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { favoriteProductBodySchema, favoriteStoreBodySchema, recentViewBodySchema } from "../schemas/customerSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const customerRoutes = Router();

customerRoutes.use(requireRoles("customer", "admin"));
customerRoutes.get("/favorites", asyncHandler(customerController.listFavorites));
customerRoutes.post("/favorites/products", validateRequest({ body: favoriteProductBodySchema }), asyncHandler(customerController.addFavoriteProduct));
customerRoutes.delete("/favorites/products/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(customerController.removeFavoriteProduct));
customerRoutes.post("/favorites/stores", validateRequest({ body: favoriteStoreBodySchema }), asyncHandler(customerController.addFavoriteStore));
customerRoutes.delete("/favorites/stores/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(customerController.removeFavoriteStore));
customerRoutes.get("/recent-views", asyncHandler(customerController.listRecentViews));
customerRoutes.post("/recent-views", validateRequest({ body: recentViewBodySchema }), asyncHandler(customerController.addRecentView));
