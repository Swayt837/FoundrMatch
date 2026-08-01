/**
 * Send a local file to a presigned storage URL — native implementation.
 *
 * `FileSystem.uploadAsync` streams the file from disk rather than reading it
 * into a JS Blob first, which is what keeps a multi-megabyte photo from being
 * held in memory twice on the way out.
 *
 * The web build resolves `index.web.ts` instead: expo-file-system has no
 * browser implementation, and there the picker hands back a blob URL that
 * `fetch` can read directly.
 *
 * The import is `expo-file-system/legacy` on purpose. SDK 54 replaced the
 * module's surface with the File/Directory API, which has no upload primitive;
 * `uploadAsync` still exists but only under that path.
 */
import * as FileSystem from 'expo-file-system/legacy';

export async function putFile(
  uploadUrl: string,
  localUri: string,
  contentType: string
): Promise<void> {
  const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    // Must match the type signed into the URL, or storage rejects the upload.
    headers: { 'Content-Type': contentType },
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed with status ${result.status}`);
  }
}
