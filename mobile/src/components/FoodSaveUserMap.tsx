import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import {
  createFoodSaveSocket,
  REALTIME_EVENTS
} from "../realtime/foodsaveSocket";
import type {
  SellerReputationStatus,
  StoreStatusChangedPayload
} from "../types/reputation";

export interface FoodSaveMapStore {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  status: SellerReputationStatus;
}

interface FoodSaveUserMapProps {
  initialStores: FoodSaveMapStore[];
  authToken?: string;
  socketUrl?: string;
  onStorePress?: (store: FoodSaveMapStore) => void;
}

const defaultRegion: Region = {
  latitude: 10.7769,
  longitude: 106.7009,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08
};

const shouldHideStoreFromMap = (status: SellerReputationStatus): boolean => {
  return status === "Restricted" || status === "Banned";
};

export const FoodSaveUserMap = ({
  initialStores,
  authToken,
  socketUrl,
  onStorePress
}: FoodSaveUserMapProps): JSX.Element => {
  const [stores, setStores] = useState<FoodSaveMapStore[]>(initialStores);
  const [hiddenSellerIds, setHiddenSellerIds] = useState<Set<string>>(
    () => new Set(initialStores.filter((store) => shouldHideStoreFromMap(store.status)).map((store) => store.id))
  );

  useEffect(() => {
    setStores(initialStores);
    setHiddenSellerIds(new Set(initialStores.filter((store) => shouldHideStoreFromMap(store.status)).map((store) => store.id)));
  }, [initialStores]);

  useEffect(() => {
    const socket = createFoodSaveSocket({
      ...(socketUrl ? { socketUrl } : {}),
      ...(authToken ? { authToken } : {})
    });

    socket.on("connect", () => {
      // Đăng ký room bản đồ để mọi user đang xem MapView nhận thay đổi chế tài tức thời.
      socket.emit(REALTIME_EVENTS.REGISTER_USER_MAP);
    });

    socket.on(REALTIME_EVENTS.STORE_STATUS_CHANGED, (payload: StoreStatusChangedPayload) => {
      setStores((currentStores) =>
        currentStores.map((store) =>
          store.id === payload.sellerId ? { ...store, status: payload.status } : store
        )
      );

      setHiddenSellerIds((currentIds) => {
        const nextIds = new Set(currentIds);
        if (shouldHideStoreFromMap(payload.status)) {
          nextIds.add(payload.sellerId);
        } else {
          nextIds.delete(payload.sellerId);
        }
        return nextIds;
      });
    });

    return () => {
      socket.off(REALTIME_EVENTS.STORE_STATUS_CHANGED);
      socket.disconnect();
    };
  }, [authToken, socketUrl]);

  const visibleStores = useMemo(
    () => stores.filter((store) => !hiddenSellerIds.has(store.id)),
    [hiddenSellerIds, stores]
  );

  const region = useMemo<Region>(() => {
    const firstStore = visibleStores[0] ?? stores[0];
    if (!firstStore) return defaultRegion;

    return {
      latitude: firstStore.latitude,
      longitude: firstStore.longitude,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08
    };
  }, [stores, visibleStores]);

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={region}>
        {visibleStores.map((store) => (
          <Marker
            key={store.id}
            coordinate={{ latitude: store.latitude, longitude: store.longitude }}
            title={store.name}
            description={store.address}
            onPress={() => onStorePress?.(store)}
          />
        ))}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF"
  },
  map: {
    flex: 1
  }
});
