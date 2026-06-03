import { Router } from "express";
import { catalogController } from "../controllers/catalogController";
import { authMiddleware, requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { asyncHandler } from "../utils/asyncHandler";
import { uuidParamSchema } from "../schemas/commonSchemas";
import {
  createProductBodySchema,
  createStoreBodySchema,
  createVoucherBodySchema,
  productListQuerySchema,
  storeListQuerySchema,
  updateProductBodySchema,
  updateStoreBodySchema,
  voucherListQuerySchema
} from "../schemas/catalogSchemas";

export const catalogRoutes = Router();

catalogRoutes.get("/products", validateRequest({ query: productListQuerySchema }), asyncHandler(catalogController.listProducts));
catalogRoutes.get("/products/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(catalogController.getProduct));
catalogRoutes.get("/stores", validateRequest({ query: storeListQuerySchema }), asyncHandler(catalogController.listStores));
catalogRoutes.get("/stores/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(catalogController.getStore));
catalogRoutes.get("/vouchers", validateRequest({ query: voucherListQuerySchema }), asyncHandler(catalogController.listVouchers));

catalogRoutes.post("/stores", authMiddleware, requireRoles("partner", "admin"), validateRequest({ body: createStoreBodySchema }), asyncHandler(catalogController.createStore));
catalogRoutes.patch("/stores/:id", authMiddleware, requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: updateStoreBodySchema }), asyncHandler(catalogController.updateStore));
catalogRoutes.post("/products", authMiddleware, requireRoles("partner", "admin"), validateRequest({ body: createProductBodySchema }), asyncHandler(catalogController.createProduct));
catalogRoutes.patch("/products/:id", authMiddleware, requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: updateProductBodySchema }), asyncHandler(catalogController.updateProduct));
catalogRoutes.delete("/products/:id", authMiddleware, requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema }), asyncHandler(catalogController.deleteProduct));
catalogRoutes.post("/vouchers", authMiddleware, requireRoles("partner", "admin"), validateRequest({ body: createVoucherBodySchema }), asyncHandler(catalogController.createVoucher));
