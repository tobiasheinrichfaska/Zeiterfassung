/** Browser file handling: save a file, offer it to the share sheet, read a chosen file. */

export function downloadFile(name: string, type: string, data: string | Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Whether the device can hand this file to another app (mail, messenger) directly. */
export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/** Opens the share sheet with the file; false when the person closed it without choosing. */
export async function shareFile(file: File, title: string): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}

export const readFileText = (file: File): Promise<string> => file.text();
