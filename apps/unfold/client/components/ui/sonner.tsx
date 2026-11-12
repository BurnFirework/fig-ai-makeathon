import { Toaster as Sonner, type ToasterProps } from 'sonner'

/** Notifications in the board's stationery, bottom right (styled in index.css under `.unfold-toaster`). */
export function Toaster(props: ToasterProps) {
  return <Sonner className="unfold-toaster" position="bottom-right" theme="light" duration={5000} visibleToasts={3} closeButton {...props}/>
}
