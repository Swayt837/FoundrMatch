/**
 * Full-screen view of one showcase item.
 *
 * Video only plays here, never in the swipe deck or the profile grid: a list
 * that autoplays spends data on things nobody asked to watch, and several
 * players alive at once is how a scroll starts stuttering.
 */
import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { theme } from '@/src/theme';

export interface ShowcaseItem {
  url: string;
  kind: 'image' | 'video';
  thumbnail_url?: string;
  caption?: string;
}

export function ShowcaseViewer({
  item,
  onClose,
}: {
  item: ShowcaseItem | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const isVideo = item?.kind === 'video';

  // The hook cannot be called conditionally, so the player is always created and
  // simply has no source until a video is opened.
  const player = useVideoPlayer(isVideo ? item!.url : null, (instance) => {
    instance.loop = true;
    // Opening a video is an explicit request to watch it.
    instance.play();
  });

  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={[styles.close, { top: insets.top + 12 }]}
          onPress={onClose}
          testID="showcase-viewer-close"
        >
          <X size={20} color={theme.colors.text} strokeWidth={2} />
        </TouchableOpacity>

        {item && (isVideo ? (
          <VideoView
            style={styles.media}
            player={player}
            contentFit="contain"
            allowsFullscreen
            nativeControls
          />
        ) : (
          <Image source={{ uri: item.url }} style={styles.media} resizeMode="contain" />
        ))}

        {!!item?.caption && (
          <Text style={[styles.caption, { paddingBottom: insets.bottom + 24 }]}>
            {item.caption}
          </Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? 'rgba(9,9,11,0.96)' : theme.colors.surface,
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
    right: 16,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  media: { width: '100%', height: '70%' },
  caption: {
    ...theme.typography.subhead,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
});
