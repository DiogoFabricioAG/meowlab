export const MAX_SPREADSHEET_BYTES = 2 * 1024 * 1024;

export const isSpreadsheet = (filename: string, mimeType: string): boolean =>
  /\.(xlsx|csv)$/i.test(filename) || /spreadsheetml|text\/csv|application\/csv/i.test(mimeType);

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
