/**
 * A video surface for one participant of a call — web.
 *
 * `srcObject` is assigned through a ref rather than passed as a prop: it takes a
 * `MediaStream` object, which cannot be serialised into an attribute.
 */
import React, { useEffect, useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

export interface CallVideoProps {
  stream: any | null;
  mirror?: boolean;
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
  const videoRef = useRef<any>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream ?? null;
  }, [stream]);

  if (!stream) return <View style={style} testID={testID} />;

  return (
    <View style={style} testID={testID}>
      {React.createElement('video', {
        ref: videoRef,
        autoPlay: true,
        playsInline: true,
        // The local preview must be muted or the room echoes.
        muted: mirror,
        style: {
          width: '100%',
          height: '100%',
          objectFit,
          transform: mirror ? 'scaleX(-1)' : undefined,
        },
      })}
    </View>
  );
}
