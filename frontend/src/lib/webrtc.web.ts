/**
 * WebRTC bindings — web.
 *
 * The browser already implements this API, so the web build uses it directly and
 * never loads `react-native-webrtc` (which has no web build). Metro resolves this
 * file ahead of `webrtc.ts` for the web platform.
 *
 * `getUserMedia` requires a secure context: it works on `localhost` and over HTTPS,
 * and is unavailable on a plain-HTTP LAN address. That is a browser rule, not
 * something the app can work around — hence `isSupported` reporting it honestly
 * rather than failing at the moment the user taps Call.
 */
const globalScope: any = typeof globalThis !== 'undefined' ? globalThis : {};

export const RTCPeerConnection = globalScope.RTCPeerConnection;
export const RTCSessionDescription = globalScope.RTCSessionDescription;
export const RTCIceCandidate = globalScope.RTCIceCandidate;
export const MediaStream = globalScope.MediaStream;

export const mediaDevices = globalScope.navigator?.mediaDevices;

export const isSupported =
  typeof RTCPeerConnection === 'function' && typeof mediaDevices?.getUserMedia === 'function';
