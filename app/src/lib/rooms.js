/* The room registry. Order is light → dark.
   `label` shows in the pill; `id` maps to the [data-room] CSS in rooms.css. */
export const ROOMS = [
  { id: 'linen',   label: 'Linen',   note: 'White silence, one rust cursor' },
  { id: 'cobalt',  label: 'Cobalt',  note: 'White silence, one cobalt cursor' },
  { id: 'dawn',    label: 'Dawn',    note: 'Blush morning, quiet serif' },
  { id: 'paper',   label: 'Paper',   note: 'Cream and ink, a printed book' },
  { id: 'slate',   label: 'Slate',   note: "Cool dark, engineer's evening" },
  { id: 'noir',    label: 'Noir',    note: 'Midnight serif, amber caret' },
]

export const DEFAULT_ROOM = 'linen'
