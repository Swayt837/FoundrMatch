/**
 * Register this device for push notifications, and route taps.
 *
 * Runs once a user is signed in, because a token is registered against an
 * account: the same device handed to another founder must stop delivering the
 * previous one's matches, which is what the register call does server-side.
 *
 * Everything here degrades quietly. Push is a nice-to-have on top of the socket,
 * and a denied permission or a simulator must not produce an error the user has
 * to dismiss before they can use the app.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';

// Foreground behaviour: the app already shows its own banner for socket events,
// but a notification arriving while the user is on another screen should still
// surface rather than be swallowed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function getExpoPushToken(): Promise<string | null> {
  // A simulator has no push token; asking produces an error rather than null.
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    // Android refuses to display anything without a channel.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#D4AF37',
    });
  }

  // The project id is what routes a token through Expo's service to this app.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data ?? null;
}

/**
 * @param userId  the signed-in user, or undefined when signed out.
 */
export function usePushNotifications(userId?: string) {
  const router = useRouter();
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || registered.current === userId) return;

    let cancelled = false;
    (async () => {
      try {
        const token = await getExpoPushToken();
        if (!token || cancelled) return;
        await api.registerPushToken(token, Platform.OS);
        registered.current = userId;
      } catch (error) {
        console.log('Push registration skipped:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Tapping a notification should land on the thing it is about, not on
  // whatever screen the app happened to be showing.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string>;
      if (!data) return;

      if (data.type === 'message' && data.match_id) {
        router.push(`/chat/${data.match_id}`);
      } else if (data.type === 'deal_room' && data.match_id) {
        router.push(`/deal-room/${data.match_id}`);
      } else if (data.type === 'match') {
        router.push('/(tabs)/matches');
      } else if (data.project_id) {
        router.push(`/project/${data.project_id}`);
      }
    });

    return () => subscription.remove();
  }, [router]);
}
