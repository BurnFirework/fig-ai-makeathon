import { X } from 'lucide-react'
import { useState } from 'react'
import { Button, buttonVariants } from './ui/button'
import { CodeBlock, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader } from './ui/code-block'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'

const source = 'https://github.com/BurnFirework/fig-ai-makeathon'
const helperCommand = 'pnpm helper'

export function PreviewBanner({ desktop, onSettings }: { desktop: boolean; onSettings: () => void }) {
  const [scrolled, setScrolled] = useState(false)

  return <Dialog onOpenChange={open => { if (!open) setScrolled(false) }}>
    <div className="preview-banner">
      <span>Chat preview</span>
      <DialogTrigger render={<Button variant="outline" size="xs"/>}>Enable live AI</DialogTrigger>
    </div>
    <DialogContent showCloseButton={false} className="live-ai-dialog max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto sm:max-w-lg" onScroll={event => setScrolled(event.currentTarget.scrollTop > 12)} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <DialogHeader className="live-ai-header sticky top-0 z-10 flex-row items-center justify-between px-6 py-3" data-scrolled={scrolled || undefined}>
        <DialogTitle>Enable live AI</DialogTitle>
        <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close"/>}><X/></DialogClose>
      </DialogHeader>
      <div className="grid min-w-0 gap-6 px-6 pt-4 pb-6">
        <DialogDescription>{desktop ? 'Chats currently use sample replies.' : 'Choose either setup option to switch from sample replies to live AI.'} Live AI sends chat inputs to your signed-in provider.</DialogDescription>
        {desktop ? <section className="grid gap-2">
          <p>Install and sign in to Claude Code or Codex on this computer, then select it under Agent provider.</p>
          <DialogClose render={<Button className="justify-self-start" onClick={onSettings}/>}>Open Board settings</DialogClose>
        </section> : <>
          <section className="grid gap-2">
            <h3 className="font-semibold">Install the desktop app</h3>
            <p>Available for Apple Silicon Macs and x64 Linux. Install and sign in to Claude Code or Codex separately.</p>
            <a className={buttonVariants({ size: 'sm', className: 'justify-self-start' })} href="https://unfold.bezr.dev/" target="_blank" rel="noopener noreferrer">See desktop downloads</a>
          </section>
          <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">or</div>
          <section className="grid gap-2">
            <h3 className="font-semibold">Run the local helper</h3>
            <p>Clone the <a className="underline" href={source} target="_blank" rel="noopener noreferrer">Unfold repository</a>. Requires Node 22.14+ and pnpm 10.33.1. Open Terminal in your Unfold checkout, then run this to install dependencies, sign in to Codex if needed, and start the helper.</p>
            <CodeBlock>
              <CodeBlockHeader title="Terminal"><CodeBlockCopyButton value={helperCommand}/></CodeBlockHeader>
              <CodeBlockContent>{helperCommand}</CodeBlockContent>
            </CodeBlock>
            <p>Open the local URL printed by Vite in Terminal. Keep Terminal open while you use Unfold. The helper listens only on this computer. Press <kbd>Ctrl+C</kbd> to stop it and run <code>pnpm dev</code> from the project folder to start it again.</p>
            <p className="text-muted-foreground">The local browser app starts with its own boards. To move your current boards to the desktop app, export them from the board menu, then import the file there.</p>
          </section>
        </>}
      </div>
    </DialogContent>
  </Dialog>
}
