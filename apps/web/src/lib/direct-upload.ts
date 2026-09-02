export function uploadDirectly(
  url: string,
  file: File,
  requiredHeaders: Record<string, string>,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    Object.entries(requiredHeaders).forEach(([name, value]) => {
      request.setRequestHeader(name, value);
    });
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new Error(`Object storage rejected the upload (${request.status}).`),
        );
      }
    });
    request.addEventListener("error", () => {
      reject(new Error("The upload could not reach object storage."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("The upload was cancelled."));
    });
    request.send(file);
  });
}
