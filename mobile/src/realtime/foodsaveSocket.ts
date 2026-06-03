import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import type { StoreStatusChangedPayload } from "../types/reputation";

export const DEFAULT_FOODSAVE_SOCKET_URL = "http://10.0.2.2:8080";

export const REALTIME_EVENTS = {
  REGISTER_SELLER_DASHBOARD: "REGISTER_SELLER_DASHBOARD",
  REGISTER_USER_MAP: "REGISTER_USER_MAP",
  STORE_STATUS_CHANGED: "STORE_STATUS_CHANGED"
} as const;

export type FoodSaveSocket = Socket<{
  STORE_STATUS_CHANGED: (payload: StoreStatusChangedPayload) => void;
}, {
  REGISTER_SELLER_DASHBOARD: (payload: { sellerId: string }) => void;
  REGISTER_USER_MAP: () => void;
}>;

interface CreateFoodSaveSocketOptions {
  socketUrl?: string;
  authToken?: string;
}

export const createFoodSaveSocket = (options: CreateFoodSaveSocketOptions = {}): FoodSaveSocket => {
  const { socketUrl = DEFAULT_FOODSAVE_SOCKET_URL, authToken } = options;

  const socketOptions: Partial<ManagerOptions & SocketOptions> = {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Number.POSITIVE_INFINITY,
    reconnectionDelay: 1000,
    timeout: 10000
  };

  if (authToken) {
    socketOptions.auth = { token: authToken };
  }

  return io(socketUrl, socketOptions);
};
