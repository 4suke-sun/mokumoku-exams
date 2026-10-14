import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { checkImageMetadata, imageMetadataKinds } from "./image-metadata-check.ts";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, body = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body, Buffer.alloc(4)]); // CRC は検査しないので 0
}

const png = (...types: string[]) =>
  Buffer.concat([
    SIGNATURE,
    pngChunk("IHDR", Buffer.alloc(13)),
    ...types.map((t) => pngChunk(t, Buffer.from("k\0v"))),
    pngChunk("IEND"),
  ]);

function jpegSegment(marker: number, body: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

const jpeg = (...segments: Buffer[]) =>
  Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from([0xff, 0xda, 0, 2, 0, 0, 0xff, 0xd9])]);

describe("imageMetadataKinds", () => {
  it("メタデータのない PNG_空を返す", () => {
    expect(imageMetadataKinds("a.png", png())).toEqual([]);
  });

  it("PNG のテキスト領域と EXIF_種類を返す", () => {
    expect(imageMetadataKinds("a.png", png("tEXt"))).toEqual(["埋め込みテキスト"]);
    expect(imageMetadataKinds("a.png", png("iTXt", "zTXt"))).toEqual(["埋め込みテキスト"]);
    expect(imageMetadataKinds("a.png", png("eXIf", "tEXt"))).toEqual(["EXIF", "埋め込みテキスト"]);
  });

  it("メタデータのない JPEG_空を返す", () => {
    expect(imageMetadataKinds("a.jpg", jpeg(jpegSegment(0xe0, Buffer.from("JFIF\0"))))).toEqual([]);
  });

  it("JPEG の EXIF・XMP・IPTC・コメント_種類を返す", () => {
    const exif = jpegSegment(0xe1, Buffer.from("Exif\0\0MM"));
    const xmp = jpegSegment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x/>"));
    const iptc = jpegSegment(0xed, Buffer.from("Photoshop 3.0\0"));
    const comment = jpegSegment(0xfe, Buffer.from("text"));
    expect(imageMetadataKinds("a.jpeg", jpeg(exif, xmp, iptc, comment))).toEqual(["EXIF", "XMP", "IPTC", "コメント"]);
  });

  it("画像ではない内容や壊れた内容_空を返す", () => {
    expect(imageMetadataKinds("a.png", Buffer.from("not an image"))).toEqual([]);
    expect(imageMetadataKinds("a.txt", png("tEXt"))).toEqual([]);
    expect(imageMetadataKinds("a.jpg", Buffer.from([0xff, 0xd8, 0xff]))).toEqual([]);
  });
});

describe("checkImageMetadata", () => {
  it("メタデータのある画像_場所と種類だけを報告する", () => {
    const files: Record<string, Buffer> = { "x/a.png": png("tEXt"), "x/b.png": png(), "x/c.md": Buffer.from("t") };
    const hits = checkImageMetadata(Object.keys(files), (f) => files[f] as Buffer);
    expect(hits).toEqual(["画像のメタデータ(埋め込みテキスト): x/a.png"]);
  });

  it("リポジトリが追跡している既存の画像_止めない", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    const hits = checkImageMetadata(tracked, (f) => execFileSync("git", ["show", `:${f}`], { maxBuffer: 1 << 28 }));
    expect(hits).toEqual([]);
  });
});
