import React, { useState, useEffect, useCallback, useRef } from 'react'
import ConfirmDeleteButton from './ConfirmDeleteButton.jsx'

const isDesktop = typeof window !== 'undefined' && !!window.desktop

// pdfjs-dist is a large, legacy-built library (it even warns about eval() use
// at build time) — loading it eagerly at import time risks it taking the
// whole app down before anything renders if it fails to initialize in this
// environment. Loading it lazily, only when a PDF thumbnail is actually
// requested, means a failure here can never do more than fall back to a
// plain icon for that one file.
let pdfjsLibPromise = null
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.js?url'),
    ]).then(([lib, workerUrlModule]) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrlModule.default
      return lib
    })
  }
  return pdfjsLibPromise
}

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']
const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}

function iconFor(name) {
  const ext = extOf(name)
  if (IMAGE_EXTS.includes(ext) || ext === 'heic') return '🖼️'
  if (ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  return '📎'
}

export function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Renders page 1 of a PDF to a small square-ish thumbnail and returns a data URL
export async function renderPdfThumbnail(bytes, targetSize = 160) {
  const pdfjsLib = await loadPdfjs()
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const page = await pdf.getPage(1)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = targetSize / Math.max(baseViewport.width, baseViewport.height)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png')
}

// One tile: shows a real thumbnail for images/PDFs once loaded, an icon meanwhile/fallback
export function FileTile({ file, onOpen, onRemove }) {
  const [thumb, setThumb] = useState(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const ext = extOf(file.name)
    const isImage = IMAGE_EXTS.includes(ext)
    const isPdf = ext === 'pdf'
    if (!isImage && !isPdf) return

    let cancelled = false
    ;(async () => {
      try {
        const base64 = await window.desktop.readFileBytes(file.path)
        if (!base64 || cancelled) return
        if (isImage) {
          if (mounted.current) setThumb(`data:${MIME_BY_EXT[ext] || 'image/jpeg'};base64,${base64}`)
        } else if (isPdf) {
          const bytes = base64ToBytes(base64)
          const dataUrl = await renderPdfThumbnail(bytes)
          if (mounted.current && !cancelled) setThumb(dataUrl)
        }
      } catch {
        // if rendering fails for any reason, just fall back to the icon — not worth surfacing an error for a thumbnail
      }
    })()
    return () => { cancelled = true }
  }, [file.path, file.name])

  return (
    <div style={tileStyle} onClick={onOpen} title={file.name}>
      <ConfirmDeleteButton
        onConfirm={onRemove} ariaLabel="Remove file" confirmText={`Remove "${file.name}"? This can't be undone.`}
        wrapperStyle={{ position: 'absolute', top: -4, right: 4, zIndex: 1 }}
        style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--red)', color: '#fff', border: 'none', fontSize: 11, lineHeight: '16px', cursor: 'pointer', padding: 0 }}
      />
      <div style={iconWrapStyle}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--rs)' }} />
        ) : (
          <span>{iconFor(file.name)}</span>
        )}
      </div>
      <div style={nameStyle}>{file.name}</div>
    </div>
  )
}

const tileStyle = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  width: 84, cursor: 'pointer', position: 'relative',
}
const iconWrapStyle = {
  width: 64, height: 64, borderRadius: 'var(--rs)', background: 'var(--surface)',
  border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 30, overflow: 'hidden',
}
const nameStyle = {
  fontSize: 10.5, color: 'var(--text-mid)', textAlign: 'center', wordBreak: 'break-word',
  lineHeight: 1.25, maxWidth: 84,
}
// folderPath: path relative to the data root, e.g. "Jobs/CANA/RDP Basement Lighting/Files"
export default function FileAttachments({ folderPath, imageOnly = false }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(isDesktop)

  const refresh = useCallback(async () => {
    if (!isDesktop || !folderPath) return
    setLoading(true)
    const list = await window.desktop.listFiles(folderPath)
    setFiles(list || [])
    setLoading(false)
  }, [folderPath])

  useEffect(() => { refresh() }, [refresh])

  async function addFiles() {
    const list = await window.desktop.addFiles(folderPath)
    if (list) setFiles(list)
  }

  function openFile(f) { window.desktop.openFile(f.path) }

  async function removeFile(f) {
    await window.desktop.removeFile(f.path)
    refresh()
  }

  const visibleFiles = imageOnly ? files.filter(f => IMAGE_EXTS.includes(extOf(f.name))) : files

  if (!isDesktop) {
    return (
      <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
        File attachments (prints, PDFs, photos) work once this is running as the desktop app — they're saved right in this project's folder on your computer.
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {visibleFiles.map(f => (
          <FileTile key={f.path} file={f} onOpen={() => openFile(f)} onRemove={() => removeFile(f)} />
        ))}
        <div style={tileStyle} onClick={addFiles}>
          <div style={{ ...iconWrapStyle, border: '1.5px dashed var(--border)', background: 'var(--surface-2)', color: 'var(--accent-dim)', fontWeight: 700, fontSize: 22 }}>+</div>
          <div style={nameStyle}>Add files</div>
        </div>
      </div>
      {!loading && files.length === 0 && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-light)' }}>
          No files yet — click + Add files to attach prints, PDFs, or photos.
        </div>
      )}
    </div>
  )
}
