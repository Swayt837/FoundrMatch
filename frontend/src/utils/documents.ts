/**
 * Pick a file and put it in a deal room.
 *
 * Three steps, in this order for a reason: ask the server for permission, send
 * the bytes straight to storage, then record the document. Nothing is written
 * to the room until the upload has actually landed, so a failed transfer leaves
 * an orphaned object rather than an entry pointing at a file that is not there.
 */
import * as DocumentPicker from 'expo-document-picker';
import { api } from '@/src/api/client';
import { putFile } from '@/src/utils/uploads';

/** Mirrors DOCUMENT_EXTENSIONS in backend/storage.py. */
export const ACCEPTED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
  'xls', 'xlsx', 'ods', 'csv',
  'ppt', 'pptx', 'odp',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
  'zip',
];

/** Matches MAX_DOCUMENT_BYTES server-side; checked here to fail before the transfer. */
const MAX_BYTES = 25 * 1024 * 1024;

export interface PickedDocument {
  storage_key: string;
  filename: string;
  size_bytes?: number;
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Open the picker and upload the chosen file.
 *
 * Returns null when the user cancels. Throws with a readable message on
 * anything else, so the screen can show it as-is.
 */
export async function pickAndUploadDocument(roomId: string): Promise<PickedDocument | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    // Copying into the cache guarantees a readable local URI: on Android a
    // content:// URI from another app is not readable once its permission
    // grant is gone.
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (picked.canceled || !picked.assets?.length) return null;
  const asset = picked.assets[0];

  const extension = asset.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    throw new Error(`Files of type .${extension || '?'} are not accepted`);
  }

  if (asset.size && asset.size > MAX_BYTES) {
    throw new Error(`That file is too large (max ${formatSize(MAX_BYTES)})`);
  }

  const contentType = asset.mimeType || 'application/octet-stream';
  const { upload_url, key } = await api.createDocumentUpload(roomId, asset.name, contentType);
  await putFile(upload_url, asset.uri, contentType);

  // `key` is what the room records; the caller passes it to addDealRoomDocument.
  return { storage_key: key, filename: asset.name, size_bytes: asset.size ?? undefined };
}
