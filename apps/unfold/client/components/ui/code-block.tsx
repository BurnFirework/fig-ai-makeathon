import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from './button'

// Plain-text subset of the shadcn/ui Base Vega Code Block.
export function CodeBlock({ children }: { children: ReactNode }) {
  return <div data-slot="code-block" className="flex min-w-0 flex-col rounded-lg border border-input bg-muted/40 text-foreground">
    {children}
  </div>
}

export function CodeBlockHeader({ title, children }: { title: string; children: ReactNode }) {
  return <div data-slot="code-block-header" className="flex items-center justify-between gap-2 border-b border-input px-3 py-1.5 text-xs font-medium text-muted-foreground">
    <span>{title}</span>
    {children}
  </div>
}

export function CodeBlockContent({ children }: { children: string }) {
  return <pre data-slot="code-block-content" dir="ltr" tabIndex={0} className="min-w-0 overflow-x-auto rounded-b-lg p-3 text-start font-mono text-xs leading-relaxed focus-visible:ring-2 focus-visible:ring-ring">
    <code>{children}</code>
  </pre>
}

export function CodeBlockCopyButton({ value }: { value: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    await navigator.clipboard.writeText(value)
    setStatus('copied')
  }

  return <div className="flex items-center gap-2">
    <span role="status" className={status === 'failed' ? 'font-normal' : 'sr-only'}>
      {status === 'copied' ? 'Copied to clipboard.' : status === 'failed' ? 'Select and copy the command manually.' : ''}
    </span>
    <Button data-slot="code-block-copy-button" variant="ghost" size="xs" onClick={() => {
      copy().catch(() => setStatus('failed'))
    }}>
      {status === 'copied' ? <CheckIcon/> : <CopyIcon/>}
      {status === 'copied' ? 'Copied' : 'Copy'}
    </Button>
  </div>
}
