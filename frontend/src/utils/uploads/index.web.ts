/**
 * Send an image to a presigned storage URL — web implementation.
 *
 * expo-file-system has no browser implementation, so this file is resolved
 * instead by Metro's platform extensions. On web the picker returns a blob or
 * data URL that `fetch` can read directly, so the round trip is just: read it
 * back as a Blob, PUT it.
 */
export async function putImage(
  uploadUrl: string,
  localUri: string,
  contentType: string
): Promise<void> {
  const blob = await (await fetch(localUri)).blob();

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    // Must match the type signed into the URL, or storage rejects the upload.
    headers: { 'Content-Type': contentType },
    body: blob,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
}
