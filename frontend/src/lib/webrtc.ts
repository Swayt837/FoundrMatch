/**
 * WebRTC bindings — native (iOS / Android).
 *
 * `react-native-webrtc` has no web build, and the app ships to web from the same
 * codebase, so the API is reached through this module and Metro picks `webrtc.web.ts`
 * for the web bundle. Nothing else in the app imports `react-native-webrtc`
 * directly — do not add such an import, it breaks the web build.
 *
 * The native module is not available in Expo Go either: it needs a development build
 * (`yarn prebuild` then a native run), which is why the call screen degrades with a
 * message rather than crashing when `isSupported` is false.
 */
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  registerGlobals,
} from 'react-native-webrtc';

// Makes `navigator.mediaDevices` and friends resolve to the native implementation,
// so any code written against the standard API behaves the same on both platforms.
registerGlobals();

export {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
};

/** True when a peer connection can actually be created on this platform/build. */
export const isSupported = typeof RTCPeerConnection === 'function';
