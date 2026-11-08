import React, { useEffect, useState } from 'react'
import { findProposal } from '../api/proposal.js'

// "📄 Proposal" — opens the proposal PDF saved in the quote's Files
export default function ProposalPill({ customerFolder, quote, size = 'small' }) {
  const [file, setFile] = useState(null)
  useEffect(() => {
    let live = true
    findProposal(customerFolder, quote).then(f => { if (live) setFile(f) })
    return () => { live = false }
  }, [customerFolder, quote && quote.id, quote && quote.folder, quote && quote.title])
  if (!file) return null
  const big = size === 'big'
  return (
    <button
      onClick={e => { e.stopPropagation(); window.desktop.openFile(file.path) }}
      title={`Open ${file.name}`}
      style={{ fontSize: big ? 12.5 : 11, fontWeight: 700, padding: big ? '7px 13px' : '3px 10px', borderRadius: 20, border: '1px solid #1a5fa0', background: '#e8f2fc', color: '#1a5fa0', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
      📄 Proposal
    </button>
  )
}
