/**
 * True for a scalar drawn as the value of a `display: 'card'` record row. The row is a subgrid of
 * the record's `key | value | sidecar` columns (stage.css), so the scalar spans the value and
 * sidecar columns and its stamps line up with the other rows'. Only scalars get the flag (they
 * have no children to inherit it); other kinds take both columns and draw their own sidecar.
 */
import { createContext } from 'react'

export const CardRowContext = createContext(false)
