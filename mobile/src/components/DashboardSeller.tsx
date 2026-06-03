import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import {
  createFoodSaveSocket,
  REALTIME_EVENTS
} from "../realtime/foodsaveSocket";
import type {
  SellerDashboardStatus,
  StoreStatusChangedPayload
} from "../types/reputation";

interface DashboardSellerProps {
  sellerId: string;
  initialStatus: SellerDashboardStatus;
  authToken?: string;
  socketUrl?: string;
  onCreateNewDish: () => void;
}

const millisecondsUntil = (restrictedUntil: string | null): number => {
  if (!restrictedUntil) return 0;
  return Math.max(new Date(restrictedUntil).getTime() - Date.now(), 0);
};

const formatCountdown = (remainingMilliseconds: number): string => {
  const totalSeconds = Math.floor(remainingMilliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export const DashboardSeller = ({
  sellerId,
  initialStatus,
  authToken,
  socketUrl,
  onCreateNewDish
}: DashboardSellerProps): JSX.Element => {
  const [storeStatus, setStoreStatus] = useState<SellerDashboardStatus>(initialStatus);
  const [remainingMilliseconds, setRemainingMilliseconds] = useState<number>(
    millisecondsUntil(initialStatus.restrictedUntil)
  );

  useEffect(() => {
    const socket = createFoodSaveSocket({
      ...(socketUrl ? { socketUrl } : {}),
      ...(authToken ? { authToken } : {})
    });

    socket.on("connect", () => {
      // Đăng ký room riêng của seller để backend phát đúng dashboard cần cập nhật.
      socket.emit(REALTIME_EVENTS.REGISTER_SELLER_DASHBOARD, { sellerId });
    });

    socket.on(REALTIME_EVENTS.STORE_STATUS_CHANGED, (payload: StoreStatusChangedPayload) => {
      if (payload.sellerId !== sellerId) return;

      setStoreStatus({
        status: payload.status,
        trustScore: payload.trustScore,
        ratingAverage: payload.ratingAverage,
        restrictedUntil: payload.restrictedUntil,
        message: payload.message
      });
      setRemainingMilliseconds(millisecondsUntil(payload.restrictedUntil));
    });

    return () => {
      socket.off(REALTIME_EVENTS.STORE_STATUS_CHANGED);
      socket.disconnect();
    };
  }, [authToken, sellerId, socketUrl]);

  useEffect(() => {
    if (storeStatus.status !== "Restricted") {
      setRemainingMilliseconds(0);
      return;
    }

    const timer = setInterval(() => {
      setRemainingMilliseconds(millisecondsUntil(storeStatus.restrictedUntil));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [storeStatus.restrictedUntil, storeStatus.status]);

  const countdownText = useMemo(
    () => formatCountdown(remainingMilliseconds),
    [remainingMilliseconds]
  );

  if (storeStatus.status === "Banned") {
    return (
      <SafeAreaView style={styles.bannedScreen}>
        <View style={styles.bannedPanel}>
          <Text style={styles.bannedTitle}>Tài khoản cửa hàng đã bị khóa vĩnh viễn</Text>
          <Text style={styles.bannedMessage}>{storeStatus.message}</Text>
          <Text style={styles.bannedMetric}>Điểm uy tín: {storeStatus.trustScore}/100</Text>
          <Text style={styles.bannedMetric}>Sao trung bình: {storeStatus.ratingAverage.toFixed(1)}/5</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isRestricted = storeStatus.status === "Restricted";

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>FoodSave Seller</Text>
        <Text style={styles.subtitle}>Điểm uy tín {storeStatus.trustScore}/100</Text>
      </View>

      <View style={styles.metricRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Trạng thái</Text>
          <Text style={styles.metricValue}>{storeStatus.status}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Sao trung bình</Text>
          <Text style={styles.metricValue}>{storeStatus.ratingAverage.toFixed(1)}/5</Text>
        </View>
      </View>

      {isRestricted ? (
        <View style={styles.warningBanner}>
          <Text style={styles.warningTitle}>Cửa hàng đang bị hạn chế</Text>
          <Text style={styles.warningBody}>{storeStatus.message}</Text>
          <Text style={styles.warningCountdown}>Hết hạn sau {countdownText}</Text>
        </View>
      ) : (
        <View style={styles.activeBanner}>
          <Text style={styles.activeTitle}>Cửa hàng đang hoạt động bình thường</Text>
          <Text style={styles.activeBody}>Bạn có thể đăng món mới và xử lý đơn hàng như thường lệ.</Text>
        </View>
      )}

      <TouchableOpacity
        activeOpacity={0.8}
        disabled={isRestricted}
        onPress={onCreateNewDish}
        style={[styles.createButton, isRestricted ? styles.createButtonDisabled : null]}
      >
        <Text style={styles.createButtonText}>Đăng món mới</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    padding: 20
  },
  header: {
    marginBottom: 18
  },
  title: {
    color: "#111827",
    fontSize: 28,
    fontWeight: "700"
  },
  subtitle: {
    color: "#4B5563",
    fontSize: 15,
    marginTop: 6
  },
  metricRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16
  },
  metricBox: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderColor: "#E5E7EB",
    borderWidth: 1,
    padding: 14
  },
  metricLabel: {
    color: "#6B7280",
    fontSize: 13,
    marginBottom: 8
  },
  metricValue: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "700"
  },
  warningBanner: {
    backgroundColor: "#FEF3C7",
    borderColor: "#F59E0B",
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    marginBottom: 18
  },
  warningTitle: {
    color: "#92400E",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8
  },
  warningBody: {
    color: "#78350F",
    fontSize: 14,
    lineHeight: 20
  },
  warningCountdown: {
    color: "#78350F",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 12
  },
  activeBanner: {
    backgroundColor: "#DCFCE7",
    borderColor: "#22C55E",
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    marginBottom: 18
  },
  activeTitle: {
    color: "#166534",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8
  },
  activeBody: {
    color: "#166534",
    fontSize: 14,
    lineHeight: 20
  },
  createButton: {
    alignItems: "center",
    backgroundColor: "#16A34A",
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 15
  },
  createButtonDisabled: {
    backgroundColor: "#9CA3AF",
    opacity: 0.45
  },
  createButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700"
  },
  bannedScreen: {
    flex: 1,
    backgroundColor: "#7F1D1D",
    padding: 20,
    justifyContent: "center"
  },
  bannedPanel: {
    backgroundColor: "#FEE2E2",
    borderColor: "#EF4444",
    borderRadius: 8,
    borderWidth: 1,
    padding: 22
  },
  bannedTitle: {
    color: "#7F1D1D",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 12
  },
  bannedMessage: {
    color: "#991B1B",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16
  },
  bannedMetric: {
    color: "#7F1D1D",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 6
  }
});
