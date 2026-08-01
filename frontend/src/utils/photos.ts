/**
 * Turn a picked image into something a profile can store.
 *
 * The happy path uploads to object storage and returns its URL, so the profile
 * holds a link rather than the image itself. If storage is not configured on the
 * server — it answers 503 — or the upload fails for any other reason, this falls
 * back to the inline base64 the app used before. A founder halfway through
 * onboarding should not lose their photo because a bucket is missing.
 *
 * The fallback is why the picker still asks for `base64`. Once storage is live
 * everywhere and the existing photos are migrated, that flag can go, and with it
 * the memory cost of holding every picked image twice.
 */
import type { ImagePickerAsset } from 'expo-image-picker';
import { api } from '@/src/api/client';
import { putImage } from '@/src/utils/uploads';

/** Types the server signs for; anything else is sent as JPEG. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

function contentTypeOf(asset: ImagePickerAsset): string {
  const declared = asset.mimeType?.toLowerCase();
  return declared && ACCEPTED.includes(declared) ? declared : 'image/jpeg';
}

function inline(asset: ImagePickerAsset): string | null {
  return asset.base64 ? `data:${contentTypeOf(asset)};base64,${asset.base64}` : null;
}

/**
 * The string to store for this image: a storage URL, or an inline data URI.
 * Returns null only when neither route produced anything usable.
 */
export async function storablePhoto(asset: ImagePickerAsset): Promise<string | null> {
  const contentType = contentTypeOf(asset);

  try {
    const { upload_url, public_url } = await api.createPhotoUpload(contentType);
    await putImage(upload_url, asset.uri, contentType);
    return public_url;
  } catch (error) {
    // Expected when the deployment has no bucket configured; worth a line
    // either way, because silently storing megabytes inline is the kind of
    // thing that is only noticed much later.
    console.log('Photo upload unavailable, storing inline:', error);
    return inline(asset);
  }
}
