/**
 * Saves a file that was created in memory. Nothing is uploaded or stored:
 * the browser receives a temporary Blob URL, which is revoked shortly after.
 */
export function downloadFile(fileName: string, parts: BlobPart[], type: string): void {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
