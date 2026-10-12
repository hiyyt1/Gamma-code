import mammoth from "mammoth"

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  await mammoth
    .convertToHtml(
      { arrayBuffer: event.data },
      {
        externalFileAccess: false,
        includeEmbeddedStyleMap: false,
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      },
    )
    .then(
      (result) => self.postMessage({ html: result.value }),
      () => self.postMessage({ error: true }),
    )
}
