/**
 * Register this device for push notifications, and route taps.
 *
 * Runs once a user is signed in, because a token is registered against an
 * account: the same device handed to another founder must stop delivering the
 * previous one's matches, which is what the register call does server-side.
 *
 * Everything here degrades quietly, including the module itself being absent.
 * Push is a layer on top of the socket, and neither a denied permission, nor a
 * simulator, nor a binary built before this feature existed is a reason for the
 * app to fail to start.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

/**
 * expo-notifications is a native module, so it throws on a build that predates
 * it. Imported at module scope that exception would propagate into the root
 * layout — which imports this hook — and take the whole app down with a message
 * about a missing default export. Resolved lazily instead, so an old binary
 * simply has no push.
 */
function notifications(): NotificationsModule | null {
  if (cached === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cached = require('expo-notifications') as NotificationsModule;
      cached.setNotificationHandler({
        // The app shows its own banner for socket events, but a notification
        // arriving while the user is elsewhere should still surface.
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    } catch {
      cached = null;
    }
  }
  return cached;
}

async function getExpoPushToken(): Promise<string | null> {
  const Notifications = notifications();
  if (!Notifications) return null;

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

  // Throws on a simulator, which has no token to give; the caller swallows it.
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
    const Notifications = notifications();
    if (!Notifications) return;

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
