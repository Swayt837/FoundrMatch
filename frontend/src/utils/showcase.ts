/**
 * Pick and upload one showcase item — a screenshot, or a short video of the
 * thing working.
 *
 * Videos are uploaded twice: the file itself, and a still extracted from it.
 * The still is what a grid draws, so without it every tile would have to
 * download a video just to show something, and the server refuses a video that
 * arrives without one.
 *
 * Images are downscaled first, like profile photos. A founder screenshotting a
 * dashboard on a modern phone produces several megabytes of PNG for something
 * that will be displayed at card width.
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { api } from '@/src/api/client';
import { putFile } from '@/src/utils/uploads';

/** Mirrors MAX_SHOWCASE_VIDEO_SECONDS server-side. */
export const MAX_VIDEO_SECONDS = 60;
const MAX_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 0.75;

export interface ShowcaseUpload {
  url: string;
  kind: 'image' | 'video';
  thumbnail_url?: string;
  duration_seconds?: number;
  caption: string;
}

async function upload(localUri: string, contentType: string): Promise<string> {
  const { upload_url, public_url } = await api.createShowcaseUpload(contentType);
  await putFile(upload_url, localUri, contentType);
  return public_url;
}

/**
 * Open the picker and upload what was chosen.
 *
 * Returns null when the user cancels. Throws with a readable message otherwise,
 * so the screen can show it as-is.
 */
export async function pickAndUploadShowcase(): Promise<ShowcaseUpload | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 1,
    videoMaxDuration: MAX_VIDEO_SECONDS,
  });

  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const isVideo = asset.type === 'video';

  if (!isVideo) {
    const prepared = await ImageManipulator.manipulateAsync(
      asset.uri,
      asset.width && asset.width > MAX_IMAGE_WIDTH
        ? [{ resize: { width: MAX_IMAGE_WIDTH } }]
        : [],
      { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
    );

    return { url: await upload(prepared.uri, 'image/jpeg'), kind: 'image', caption: '' };
  }

  const seconds = asset.duration ? asset.duration / 1000 : undefined;
  // `videoMaxDuration` is only enforced by the system camera, not by picking an
  // existing file, so the limit is checked here too — before spending a
  // multi-megabyte upload on something the server will reject.
  if (seconds && seconds > MAX_VIDEO_SECONDS) {
    throw new Error(`Videos must be under ${MAX_VIDEO_SECONDS} seconds`);
  }

  // A frame from one second in: frame zero is often black while the recording
  // fades up, and a black tile looks like a broken one.
  const { uri: thumbnailUri } = await VideoThumbnails.getThumbnailAsync(asset.uri, {
    time: 1000,
  });

  const contentType = asset.uri.toLowerCase().endsWith('.mov')
    ? 'video/quicktime'
    : 'video/mp4';

  return {
    url: await upload(asset.uri, contentType),
    thumbnail_url: await upload(thumbnailUri, 'image/jpeg'),
    kind: 'video',
    duration_seconds: seconds,
    caption: '',
  };
}
