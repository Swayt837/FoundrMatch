/**
 * A video surface for one participant of a call — native.
 *
 * Rendering a `MediaStream` has no shared abstraction between platforms:
 * `react-native-webrtc` provides `RTCView` and takes a stream URL, the browser wants
 * a `<video>` element with `srcObject`. The split lives here so the call screen only
 * deals in streams. See `CallVideo.web.tsx` for the other half.
 */
import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { RTCView } from 'react-native-webrtc';

export interface CallVideoProps {
  stream: any | null;
  /** The local preview is mirrored — an unmirrored self-view reads as wrong. */
  mirror?: boolean;
  /** `cover` for the remote feed, `cover` for the local thumbnail too. */
  objectFit?: 'contain' | 'cover';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function CallVideo({
  stream,
  mirror = false,
  objectFit = 'cover',
  style,
  testID,
}: CallVideoProps) {
  if (!stream) return <View style={style} testID={testID} />;

  return (
    <RTCView
      streamURL={stream.toURL()}
      mirror={mirror}
      objectFit={objectFit}
      style={style as any}
      testID={testID}
    />
  );
}
