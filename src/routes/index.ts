import { Router } from "express";
import { adminRoutes } from "./adminRoutes";
import { authMiddleware } from "../middlewares/authMiddleware";
import { authRoutes } from "./authRoutes";
import { cartRoutes } from "./cartRoutes";
import { catalogRoutes } from "./catalogRoutes";
import { charityRoutes } from "./charityRoutes";
import { customerRoutes } from "./customerRoutes";
import { donationRoutes } from "./donationRoutes";
import { ecoImpactRoutes } from "./ecoImpactRoutes";
import { healthRoutes } from "./healthRoutes";
import { marketingRoutes } from "./marketingRoutes";
import { matchingRoutes } from "./matchingRoutes";
import { paymentRoutes } from "./paymentRoutes";
import { pushRoutes } from "./pushRoutes";
import { notificationRoutes } from "./notificationRoutes";
import { orderRoutes } from "./orderRoutes";
import { partnerRoutes } from "./partnerRoutes";
import { profileRoutes } from "./profileRoutes";
import { sellerReputationRoutes } from "./sellerReputationRoutes";
import { supportRoutes } from "./supportRoutes";
import { volunteerRoutes } from "./volunteerRoutes";

export const apiRoutes = Router();

apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/catalog", catalogRoutes);
apiRoutes.use("/support", supportRoutes);
apiRoutes.use("/volunteer", volunteerRoutes);
apiRoutes.use("/marketing", marketingRoutes);
apiRoutes.use("/push", pushRoutes);   // đăng ký thiết bị nhận thông báo đẩy (người mua / tình nguyện viên)
apiRoutes.use("/payments", paymentRoutes);   // webhook cổng thanh toán (chữ ký, không đăng nhập)

apiRoutes.use("/profile", authMiddleware, profileRoutes);
apiRoutes.use("/cart", authMiddleware, cartRoutes);
apiRoutes.use("/customers", authMiddleware, customerRoutes);
apiRoutes.use("/orders", authMiddleware, orderRoutes);
apiRoutes.use("/donations", authMiddleware, donationRoutes);
apiRoutes.use("/matching", authMiddleware, matchingRoutes);
apiRoutes.use("/eco-impact", authMiddleware, ecoImpactRoutes);
apiRoutes.use("/charity", charityRoutes);
apiRoutes.use("/notifications", authMiddleware, notificationRoutes);
apiRoutes.use("/partner", authMiddleware, partnerRoutes);
apiRoutes.use("/seller-reputation", authMiddleware, sellerReputationRoutes);
apiRoutes.use("/admin", authMiddleware, adminRoutes);
