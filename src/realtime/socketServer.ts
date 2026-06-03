import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "../config/env";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import type { UserRole } from "../types/domain";
import type { StoreStatusChangedPayload } from "../types/sellerReputation";
import { logger } from "../utils/logger";

export const REALTIME_EVENTS = {
  REGISTER_SELLER_DASHBOARD: "REGISTER_SELLER_DASHBOARD",
  REGISTER_USER_MAP: "REGISTER_USER_MAP",
  STORE_STATUS_CHANGED: "STORE_STATUS_CHANGED"
} as const;

let socketServer: SocketIOServer | null = null;

const sellerRoom = (sellerId: string): string => `seller:${sellerId}`;
const userMapRoom = "users:map";

const authenticateSocket = async (token: string): Promise<{ userId: string; role: UserRole }> => {
  const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);

  if (authError || !authData.user) {
    throw new Error("Invalid Socket.io authentication token");
  }

  const { data: profileData, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,role")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !profileData) {
    throw new Error("Socket.io user profile was not found");
  }

  const profile = profileData as { id: string; role: UserRole };
  return {
    userId: profile.id,
    role: profile.role
  };
};

const canJoinSellerRoom = async (sellerId: string, userId: string, role: UserRole): Promise<boolean> => {
  if (role === "admin") return true;

  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("owner_id")
    .eq("id", sellerId)
    .single();

  if (error || !data) {
    return false;
  }

  return (data as { owner_id: string }).owner_id === userId;
};

export const initializeSocketServer = (httpServer: HttpServer): SocketIOServer => {
  socketServer = new SocketIOServer(httpServer, {
    cors: {
      origin: env.SOCKET_CORS_ORIGINS,
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ["websocket", "polling"]
  });

  socketServer.use((socket, next) => {
    const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "";

    void authenticateSocket(token)
      .then((actor) => {
        socket.data.userId = actor.userId;
        socket.data.role = actor.role;
        next();
      })
      .catch((error: unknown) => {
        logger.warn("Socket authentication failed", error);
        next(new Error("Socket authentication failed"));
      });
  });

  socketServer.on("connection", (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    socket.on(REALTIME_EVENTS.REGISTER_SELLER_DASHBOARD, (payload: { sellerId?: string }) => {
      void (async () => {
        if (!payload.sellerId) return;

        const allowed = await canJoinSellerRoom(payload.sellerId, socket.data.userId as string, socket.data.role as UserRole);
        if (allowed) {
          socket.join(sellerRoom(payload.sellerId));
          return;
        }

        logger.warn("Socket seller room join was denied", {
          socketId: socket.id,
          sellerId: payload.sellerId,
          userId: socket.data.userId
        });
      })().catch((error: unknown) => {
        logger.error("Failed to join seller realtime room", error);
      });
    });

    socket.on(REALTIME_EVENTS.REGISTER_USER_MAP, () => {
      if (socket.data.userId) {
        socket.join(userMapRoom);
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  return socketServer;
};

export const getSocketServer = (): SocketIOServer => {
  if (!socketServer) {
    throw new Error("Socket.io server has not been initialized");
  }

  return socketServer;
};

export const emitStoreStatusChanged = (payload: StoreStatusChangedPayload): void => {
  if (!socketServer) {
    logger.warn("Socket.io server is not initialized; skipping STORE_STATUS_CHANGED emit", payload);
    return;
  }

  const io = socketServer;

  // Gửi riêng tới dashboard của seller để màn hình cửa hàng đổi trạng thái ngay.
  io.to(sellerRoom(payload.sellerId)).emit(REALTIME_EVENTS.STORE_STATUS_CHANGED, payload);

  // Gửi tới toàn bộ màn hình bản đồ của user để ẩn hoặc hiện lại marker theo thời gian thực.
  io.to(userMapRoom).emit(REALTIME_EVENTS.STORE_STATUS_CHANGED, payload);
};
