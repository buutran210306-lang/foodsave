import { Router } from "express";
import { cartController } from "../controllers/cartController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { addCartItemBodySchema, updateCartItemBodySchema } from "../schemas/cartSchemas";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const cartRoutes = Router();

cartRoutes.use(requireRoles("customer", "admin"));
cartRoutes.get("/", asyncHandler(cartController.getCart));
cartRoutes.post("/items", validateRequest({ body: addCartItemBodySchema }), asyncHandler(cartController.addItem));
cartRoutes.patch("/items/:id", validateRequest({ params: uuidParamSchema, body: updateCartItemBodySchema }), asyncHandler(cartController.updateItem));
cartRoutes.delete("/items/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(cartController.removeItem));
cartRoutes.delete("/", asyncHandler(cartController.clearCart));
