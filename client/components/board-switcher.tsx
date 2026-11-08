import { createContext, useContext, useState } from 'react'
import { Check, ChevronDown, LayoutGrid, Pencil, Plus } from 'lucide-react'
import { BoardNameSchema, createBoard, renameBoard, type BoardCatalog } from '../boards'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

export const BoardsContext = createContext<{ catalog: BoardCatalog; update: (catalog: BoardCatalog) => boolean } | null>(null)

export function BoardSwitcher() {
  const context = useContext(BoardsContext)
  const [editing, setEditing] = useState<'create' | 'rename' | null>(null)
  const [name, setName] = useState('')
  if (!context) return null
  const { catalog, update } = context
  const active = catalog.boards.find(board => board.id === catalog.activeId)
  const valid = BoardNameSchema.safeParse(name).success
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="workspace-name" aria-label={`Mood boards: ${active?.name ?? ''}`} />}>
        <LayoutGrid size={15}/><span className="truncate">{active?.name}</span><ChevronDown size={13}/>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mood boards</DropdownMenuLabel>
          {catalog.boards.map(board => <DropdownMenuItem key={board.id} onClick={() => update({ ...catalog, activeId: board.id })}>
            <span className="min-w-0 flex-1 truncate">{board.name}</span>{board.id === catalog.activeId && <Check aria-label="Current board"/>}
          </DropdownMenuItem>)}
        </DropdownMenuGroup>
        <DropdownMenuSeparator/>
        <DropdownMenuItem onClick={() => { setName(''); setEditing('create') }}><Plus/>New mood board</DropdownMenuItem>
        <DropdownMenuItem onClick={() => { setName(active?.name ?? ''); setEditing('rename') }}><Pencil/>Rename board</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button variant="outline" size="sm" className="new-board-button" onClick={() => { setName(''); setEditing('create') }}><Plus size={14}/><span>New board</span></Button>
    <Dialog open={editing !== null} onOpenChange={open => { if (!open) setEditing(null) }}>
      <DialogContent onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <DialogHeader><DialogTitle>{editing === 'rename' ? 'Rename mood board' : 'A new space for possibilities'}</DialogTitle><DialogDescription>{editing === 'rename' ? 'Choose a name that feels right.' : 'Keep a fresh set of inspirations together. Your other boards stay saved.'}</DialogDescription></DialogHeader>
        <form className="grid gap-5" onSubmit={event => {
          event.preventDefault()
          if (valid && update(editing === 'rename' ? renameBoard(catalog, name) : createBoard(catalog, name))) setEditing(null)
        }}>
          <div className="grid gap-2"><label htmlFor="board-name" className="text-sm font-medium">Board name</label><Input id="board-name" autoFocus placeholder="e.g. A slower summer" maxLength={80} value={name} onChange={event => setName(event.target.value)}/></div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={!valid}>{editing === 'rename' ? 'Save name' : 'Create board'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>
}
