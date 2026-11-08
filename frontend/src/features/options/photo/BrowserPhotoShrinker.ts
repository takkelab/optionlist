import { PhotoSize } from '../../../lib/PhotoSize'
import type { PhotoSizing } from '../../../lib/PhotoSize'

export interface PhotoShrinker {
  // 読めない画像なら reject する
  shrink(file: Blob): Promise<Blob>
}

const JPEG_QUALITY = 0.8

// 送る前に長辺 1280px の JPEG に縮める（api.md §5）。canvas を通すので EXIF（撮った場所など）も消える
export class BrowserPhotoShrinker implements PhotoShrinker {
  readonly #sizing: PhotoSizing = new PhotoSize()

  async shrink(file: Blob): Promise<Blob> {
    // 向きは EXIF のとおりに起こしてから描く
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      const { width, height } = this.#sizing.fit(bitmap)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('canvas に描けない')
      // JPEG は透明を持てないので、透過 PNG が黒くならないよう白を敷く
      context.fillStyle = 'white'
      context.fillRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)
      return await this.#toJpeg(canvas)
    } finally {
      bitmap.close()
    }
  }

  #toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob === null ? reject(new Error('JPEG にできない')) : resolve(blob)), 'image/jpeg', JPEG_QUALITY)
    })
  }
}
