/**
 * Turn a picked image into something a profile can store.
 *
 * Pictures are downscaled before they go anywhere. A phone camera produces
 * roughly 2 MB even at the picker's own compression, and a swipe feed showing
 * several of those over mobile data is the difference between a card that
 * appears and a card that loads. 1080px wide is more than a 3:4 card needs on
 * any current display.
 *
 * The happy path uploads to object storage and returns its URL. If storage is
 * not configured on the server — it answers 503 — or the upload fails for any
 * other reason, this falls back to the inline base64 the app used before. A
 * founder halfway through onboarding should not lose their photo because a
 * bucket is missing.
 */
import type { ImagePickerAsset } from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api } from '@/src/api/client';
import { putImage } from '@/src/utils/uploads';

/** Wide enough for a full-bleed card on any current phone, at a fraction of the bytes. */
const MAX_WIDTH = 1080;
const JPEG_QUALITY = 0.7;

/**
 * Downscale and recompress, returning both a file to upload and its base64.
 *
 * Both are produced in one pass on purpose: which one is needed depends on
 * whether the upload succeeds, and manipulating twice would mean decoding the
 * image twice.
 */
async function prepare(asset: ImagePickerAsset) {
  // Never upscale — enlarging a small photo costs bytes and adds nothing.
  const actions =
    asset.width && asset.width > MAX_WIDTH
      ? [{ resize: { width: MAX_WIDTH } }]
      : [];

  return ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
}

/**
 * The string to store for this image: a storage URL, or an inline data URI.
 * Returns null only when neither route produced anything usable.
 */
export async function storablePhoto(asset: ImagePickerAsset): Promise<string | null> {
  let prepared: ImageManipulator.ImageResult;
  try {
    prepared = await prepare(asset);
  } catch (error) {
    console.log('Could not process image:', error);
    return null;
  }

  const inline = prepared.base64 ? `data:image/jpeg;base64,${prepared.base64}` : null;

  try {
    const { upload_url, public_url } = await api.createPhotoUpload('image/jpeg');
    await putImage(upload_url, prepared.uri, 'image/jpeg');
    return public_url;
  } catch (error) {
    // Expected when the deployment has no bucket configured; worth a line
    // either way, because silently storing images inline is the kind of thing
    // that is only noticed much later.
    console.log('Photo upload unavailable, storing inline:', error);
    return inline;
  }
}
