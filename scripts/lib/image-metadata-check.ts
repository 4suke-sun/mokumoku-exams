const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);
const JPEG_EXIF = Buffer.from("Exif\0\0", "latin1");
const JPEG_XMP = Buffer.from("http://ns.adobe.com/xap/1.0/", "latin1");

export const IMAGE_FILE = /\.(png|jpe?g)$/i;

function pngKinds(data: Buffer): string[] {
  const kinds = new Set<string>();
  let pos = PNG_SIGNATURE.length;
  while (pos + 8 <= data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString("latin1", pos + 4, pos + 8);
    if (PNG_TEXT_CHUNKS.has(type)) kinds.add("埋め込みテキスト");
    if (type === "eXIf") kinds.add("EXIF");
    if (type === "IEND") break;
    pos += 12 + length;
  }
  return [...kinds];
}

function jpegKinds(data: Buffer): string[] {
  const kinds = new Set<string>();
  let pos = 2;
  while (pos + 4 <= data.length && data[pos] === 0xff) {
    const marker = data[pos + 1] as number;
    if (marker === 0xd9 || marker === 0xda) break; // 画像の本体に入ったら、メタデータの区間は終わり
    const length = data.readUInt16BE(pos + 2);
    const body = data.subarray(pos + 4, pos + 2 + length);
    if (marker === 0xe1 && body.subarray(0, JPEG_EXIF.length).equals(JPEG_EXIF)) kinds.add("EXIF");
    if (marker === 0xe1 && body.subarray(0, JPEG_XMP.length).equals(JPEG_XMP)) kinds.add("XMP");
    if (marker === 0xed) kinds.add("IPTC");
    if (marker === 0xfe) kinds.add("コメント");
    pos += 2 + length;
  }
  return [...kinds];
}

/**
 * 画像に埋め込まれたメタデータの種類を返す。位置情報・作成者・端末・ソフトウェアの名前・埋め込みのテキストは、
 * ここに入りうる(PNG のテキスト領域と EXIF、JPEG の EXIF・XMP・IPTC・コメント)。無ければ空。
 * 画像の描画に要らない領域なので、一つでもあれば止める。
 */
export function imageMetadataKinds(file: string, data: Buffer): string[] {
  if (/\.png$/i.test(file) && data.subarray(0, 8).equals(PNG_SIGNATURE)) return pngKinds(data);
  if (/\.jpe?g$/i.test(file) && data[0] === 0xff && data[1] === 0xd8) return jpegKinds(data);
  return [];
}

/** 追加・変更された画像のメタデータを検査する。報告は、場所と種類だけ。 */
export function checkImageMetadata(files: string[], read: (file: string) => Buffer): string[] {
  const hits: string[] = [];
  for (const file of files.filter((f) => IMAGE_FILE.test(f))) {
    for (const kind of imageMetadataKinds(file, read(file))) hits.push(`画像のメタデータ(${kind}): ${file}`);
  }
  return hits;
}
