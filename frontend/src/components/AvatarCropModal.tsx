import { useState, useCallback, useRef } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

interface AvatarCropModalProps {
  file: File
  onConfirm: (blob: Blob) => void
  onCancel: () => void
}

function getCroppedImg(image: HTMLImageElement, crop: Area): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const scaleX = image.naturalWidth / image.width
  const scaleY = image.naturalHeight / image.height
  canvas.width = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2d context')

  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    crop.width,
    crop.height,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob failed'))
      },
      'image/jpeg',
      0.85,
    )
  })
}

export default function AvatarCropModal({ file, onConfirm, onCancel }: AvatarCropModalProps) {
  const t = useT()
  const [imageSrc, setImageSrc] = useState<string>('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  // 加载图片
  useState(() => {
    const reader = new FileReader()
    reader.onload = () => {
      setImageSrc(reader.result as string)
    }
    reader.readAsDataURL(file)
  })

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels)
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!croppedAreaPixels || !imageRef.current) return
    try {
      const blob = await getCroppedImg(imageRef.current, croppedAreaPixels)
      onConfirm(blob)
    } catch {
      // 裁剪失败，直接使用原文件
      onConfirm(file)
    }
  }, [croppedAreaPixels, file, onConfirm])

  if (!imageSrc) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 h-14 shrink-0">
        <button
          onClick={onCancel}
          className="p-2 rounded-full hover:bg-white/10 text-white transition-colors"
        >
          <X size={22} />
        </button>
        <span className="text-white/80 text-sm font-medium">{t('avatarCrop.adjustAvatar')}</span>
        <button
          onClick={handleConfirm}
          className="px-4 py-1.5 rounded-full bg-mint-400 hover:bg-mint-500 text-white text-sm font-medium transition-colors"
        >
          {t('common.confirm')}
        </button>
      </div>

      {/* 裁剪区域 */}
      <div className="flex-1 relative">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onCropComplete={onCropComplete}
          onZoomChange={setZoom}
          onMediaLoaded={(media) => {
            // 保存图片引用用于后续 canvas 裁剪
            if (media instanceof HTMLImageElement) {
              imageRef.current = media
            }
          }}
        />
      </div>

      {/* 底部缩放控制 */}
      <div className="flex items-center justify-center gap-4 px-6 py-4 shrink-0">
        <ZoomOut size={18} className="text-white/60" />
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full max-w-xs h-1.5 rounded-full appearance-none bg-white/30 accent-mint-400"
        />
        <ZoomIn size={18} className="text-white/60" />
      </div>
    </div>
  )
}
