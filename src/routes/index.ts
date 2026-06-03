import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { authRoutes } from "./authRoutes";
import { cartRoutes } from "./cartRoutes";
import { catalogRoutes } from "./catalogRoutes";
import { charityRoutes } from "./charityRoutes";
import { customerRoutes } from "./customerRoutes";
import { donationRoutes } from "./donationRoutes";
import { healthRoutes } from "./healthRoutes";
import { notificationRoutes } from "./notificationRoutes";
import { orderRoutes } from "./orderRoutes";
import { partnerRoutes } from "./partnerRoutes";
import { profileRoutes } from "./profileRoutes";
import { sellerReputationRoutes } from "./sellerReputationRoutes";
import { supportRoutes } from "./supportRoutes";

export const apiRoutes = Router();

apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/catalog", catalogRoutes);
apiRoutes.use("/support", supportRoutes);

apiRoutes.use("/profile", authMiddleware, profileRoutes);
apiRoutes.use("/cart", authMiddleware, cartRoutes);
apiRoutes.use("/customers", authMiddleware, customerRoutes);
apiRoutes.use("/orders", authMiddleware, orderRoutes);
apiRoutes.use("/donations", authMiddleware, donationRoutes);
apiRoutes.use("/charity", charityRoutes);
apiRoutes.use("/notifications", authMiddleware, notificationRoutes);
apiRoutes.use("/partner", authMiddleware, partnerRoutes);
apiRoutes.use("/seller-reputation", authMiddleware, sellerReputationRoutes);
