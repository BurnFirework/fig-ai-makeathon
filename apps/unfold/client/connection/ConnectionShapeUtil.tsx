import { curveControls, curvePoints } from '../../shared/spatial-layout'
import { actions } from '../actions'
import { RelationshipSchema, type Relationship } from '../../shared/board-edits'
import {
	CubicBezier2d,
	Editor,
	ZERO_INDEX_KEY,
	getIndexAbove,
	Mat,
	type RecordProps,
	SVGContainer,
	T,
	ShapeUtil,
	type TLHandle,
	type TLHandleDragInfo,
	type TLShape,
	Vec,
	type VecLike,
	type VecModel,
	useEditor,
	useValue,
	vecModelValidator,
} from 'tldraw'
import { getAllConnectedNodes } from '../nodes/nodePorts'
import { getPortAtPoint } from '../ports/getPortAtPoint'
import { updatePortState } from '../ports/portState'
import {
	createOrUpdateConnectionBinding,
	getConnectionBindingPositionInPageSpace,
	getConnectionBindings,
	removeConnectionBinding,
} from './ConnectionBindingUtil'

const CONNECTION_TYPE = 'connection'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[CONNECTION_TYPE]: { start: VecModel; end: VecModel; relationship?: Relationship | undefined }
	}
}

/**
 * A connection shape is a directed connection between two node shapes. It has a start point, and an
 * end point. These are called "terminals" in the code.
 *
 * Usually, a connection will also have two ConnectionBindings. These bind each end of the shape to
 * the nodes it's connected to. The `start` and `end` properties are the positions of each end of
 * the connection, but only when there isn't a binding (ie while dragging the connection). When the
 * ends are bound, the position is derived from the connected shape instead.
 */
export type ConnectionShape = TLShape<typeof CONNECTION_TYPE>

export class ConnectionShapeUtil extends ShapeUtil<ConnectionShape> {
	static override type = CONNECTION_TYPE
	static override props: RecordProps<ConnectionShape> = {
		start: vecModelValidator,
		end: vecModelValidator,
		relationship: T.optional(T.literalEnum(...RelationshipSchema.options)),
	}

	getDefaultProps(): ConnectionShape['props'] {
		return {
			start: { x: 0, y: 0 },
			end: { x: 100, y: 100 },
		}
	}

	override canEdit(_shape: ConnectionShape) {
		return false
	}
	override canResize(_shape: ConnectionShape) {
		return false
	}
	override hideResizeHandles(_shape: ConnectionShape) {
		return true
	}
	override hideRotateHandle(_shape: ConnectionShape) {
		return true
	}
	override hideSelectionBoundsBg(_shape: ConnectionShape) {
		return true
	}
	override hideSelectionBoundsFg(_shape: ConnectionShape) {
		return true
	}
	override canSnap(_shape: ConnectionShape) {
		// disable snapping this shape to other shapes
		return false
	}
	override getBoundsSnapGeometry(_shape: ConnectionShape) {
		// disable snapping other shape to this shape
		return { points: [] }
	}

	// Define the geometry of our connection shape as a cubic bezier curve
	getGeometry(connection: ConnectionShape) {
		const { start, end, sideways } = getConnectionTerminals(this.editor, connection)
		const [cp1, cp2] = getConnectionControlPoints(start, end, sideways)
		return new CubicBezier2d({
			start: Vec.From(start),
			cp1: Vec.From(cp1),
			cp2: Vec.From(cp2),
			end: Vec.From(end),
		})
	}

	getHandles(connection: ConnectionShape): TLHandle[] {
		// Handles are draggable points on a shape. In our connection shape, we have a handle at each end.
		const { start, end } = getConnectionTerminals(this.editor, connection)
		return [
			{
				id: 'start',
				type: 'vertex',
				index: ZERO_INDEX_KEY,
				x: start.x,
				y: start.y,
			},
			{
				id: 'end',
				type: 'vertex',
				index: getIndexAbove(ZERO_INDEX_KEY),
				x: end.x,
				y: end.y,
			},
		]
	}

	// Handle dragging of connection terminals to connect/disconnect from ports
	onHandleDrag(connection: ConnectionShape, { handle }: TLHandleDragInfo<ConnectionShape>) {
		// First, get some info about the connection and the terminal we're dragging
		const existingBindings = getConnectionBindings(this.editor, connection)
		const draggingTerminal = handle.id
    if (draggingTerminal !== 'start' && draggingTerminal !== 'end') return
		const oppositeTerminal = draggingTerminal === 'start' ? 'end' : 'start'
		const oppositeTerminalShapeId = existingBindings[oppositeTerminal]?.toId

		// Find the new position of the handle in page space
		const handlePagePosition = this.editor.getShapePageTransform(connection).applyToPoint(handle)

		// Find the port at the new position
		const target = getPortAtPoint(this.editor, handlePagePosition, {
			margin: 8,
			terminal: draggingTerminal,
		})

		// only 'start' ports (outputs) can have multiple connections
		const allowsMultipleConnections = draggingTerminal === 'start'

		// does this port have an existing connection (excluding this one)?
		const hasExistingConnection =
			target?.existingConnections.some((c) => c.connectionId !== connection.id) ?? false

		// find out which nodes would create a cycle based on what the other end of the connection
		// is bound to
		const nodesWhichWouldCreateACycle = oppositeTerminalShapeId
			? getAllConnectedNodes(this.editor, oppositeTerminalShapeId, draggingTerminal)
			: null

		// update our port UI state to highlight which ports are eligible to connect to
		updatePortState(this.editor, {
			eligiblePorts: {
				terminal: draggingTerminal,
				excludeNodes: nodesWhichWouldCreateACycle,
			},
		})

		// if for whatever reason we can't connect to this port...
		const wouldCreateACycle = (target && nodesWhichWouldCreateACycle?.has(target.shape.id)) ?? false
		if (!target || (hasExistingConnection && !allowsMultipleConnections) || wouldCreateACycle) {
			// ... update our port ui state to not highlight any ports...
			updatePortState(this.editor, { hintingPort: null })

			// ... remove any existing binding for this connection terminal...
			removeConnectionBinding(this.editor, connection, draggingTerminal)

			// ... and return the connection with the new position.
			return {
				...connection,
				props: {
					[handle.id]: { x: handle.x, y: handle.y },
				},
			}
		}

		// if we can connect to this port, update our port ui state to highlight the port we're
		// connecting to
		updatePortState(this.editor, {
			hintingPort: { portId: target.port.id, shapeId: target.shape.id },
		})

		// create or update the connection binding for this connection terminal
		createOrUpdateConnectionBinding(this.editor, connection, target.shape, {
			portId: target.port.id,
			terminal: draggingTerminal,
		})

		// return the connection unmodified because we only need to update the binding.
		return connection
	}

	// Handle the end of dragging a connection terminal
	onHandleDragEnd(
		connection: ConnectionShape,
		{ handle, isCreatingShape }: TLHandleDragInfo<ConnectionShape>
	) {
		// clear our port UI state
		updatePortState(this.editor, { hintingPort: null, eligiblePorts: null })

		const draggingTerminal = handle.id
    if (draggingTerminal !== 'start' && draggingTerminal !== 'end') return

		// if we successfully connected & now have a binding, we're done!
		const bindings = getConnectionBindings(this.editor, connection)
		if (bindings[draggingTerminal]) {
      if (isCreatingShape && bindings.start && bindings.end) {
        const startId = bindings.start.toId
        const endId = bindings.end.toId
        this.editor.deleteShapes([connection.id])
        actions.get(this.editor)?.manualConnect(startId, endId)
      }
      return
    }

		if (isCreatingShape && draggingTerminal === 'end') {
			// A new connection dropped in empty space gets a fresh node to connect to
			this.editor.deleteShapes([connection.id])
		} else if (!bindings.start || !bindings.end) {
			// Letting go of an existing connection's terminal with nothing under it disconnects it
			this.editor.deleteShapes([connection.id])
		}
	}

	onHandleDragCancel() {
		// if we cancel a drag part way through, we need to clear out our port UI state.
		updatePortState(this.editor, { hintingPort: null, eligiblePorts: null })
	}

	component(connection: ConnectionShape) {
		return <ConnectionShape connection={connection} />
	}

	getIndicatorPath(connection: ConnectionShape) {
		const { start, end, sideways } = getConnectionTerminals(this.editor, connection)
		return new Path2D(getConnectionPath(start, end, sideways))
	}
}

// Main connection component that renders the SVG path
function ConnectionShape({ connection }: { connection: ConnectionShape }) {
	const editor = useEditor()

	// Get the connection terminals
	const { start, end, sideways } = useValue('terminals', () => getConnectionTerminals(editor, connection), [
		editor,
		connection,
	])

	return (
		<SVGContainer className="ConnectionShape">
			<defs><marker id={`arrow-${connection.id.replace(/:/g, '-')}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><polyline points="1,1 9,5 1,9" fill="none" stroke="currentColor" strokeWidth="1.5"/></marker></defs>
            <path markerEnd={`url(#arrow-${connection.id.replace(/:/g, '-')})`} d={getConnectionPath(start, end, sideways)} strokeDasharray={connection.props.relationship === 'reference' ? '6 5' : undefined} />
		</SVGContainer>
	)
}

/**
 * Page-space midpoint of a connection's bezier curve, for positioning the
 * center insert handle. Returns null when the connection isn't fully bound.
 */
export function getConnectionPageCenter(editor: Editor, connection: ConnectionShape): Vec | null {
	const bindings = getConnectionBindings(editor, connection)
	if (!bindings.start || !bindings.end) return null
	const startPage = getConnectionBindingPositionInPageSpace(editor, bindings.start)
	const endPage = getConnectionBindingPositionInPageSpace(editor, bindings.end)
	if (!startPage || !endPage) return null
	const [cp1, cp2] = getConnectionControlPoints(startPage, endPage, isSidePort(bindings.start.props.portId))
	// Cubic bezier midpoint at t=0.5: (P0 + 3·P1 + 3·P2 + P3) / 8
	return new Vec(
		(startPage.x + 3 * cp1.x + 3 * cp2.x + endPage.x) / 8,
		(startPage.y + 3 * cp1.y + 3 * cp2.y + endPage.y) / 8
	)
}

/** Side ports (a card's search results beside it) are joined left to right instead of top to bottom. */
export const isSidePort = (portId: string | undefined) => portId?.startsWith('side-') === true

// Connections flow top-to-bottom, so control points are offset vertically from each terminal; side links flow left to right
function getConnectionControlPoints(start: VecLike, end: VecLike, sideways = false): [Vec, Vec] {
  const [first, second] = curveControls(start, end, sideways)
  return [Vec.From(first), Vec.From(second)]
}

// Generate SVG path for the connection
function getConnectionPath(start: VecLike, end: VecLike, sideways = false) {
	const [cp1, cp2] = getConnectionControlPoints(start, end, sideways)
	return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${end.x} ${end.y}`
}

// Get the actual start and end points of a connection, considering its bindings
export function getConnectionTerminals(editor: Editor, connection: ConnectionShape) {
	// if possible, set the start and end points based on the bindings
	const bindings = getConnectionBindings(editor, connection)
	const shapeTransform = Mat.Inverse(editor.getShapePageTransform(connection))

	const getTerminal = (terminal: 'start' | 'end'): VecLike => {
		const binding = bindings[terminal]
		const inPageSpace = binding && getConnectionBindingPositionInPageSpace(editor, binding)
		// if we couldn't set the start and end points based on the bindings, use the values stored on
		// the shape itself
		return inPageSpace ? Mat.applyToPoint(shapeTransform, inPageSpace) : connection.props[terminal]
	}

	return { start: getTerminal('start'), end: getTerminal('end'), sideways: isSidePort(bindings.start?.props.portId) }
}


/** Sample the same page-space path used by rendering and hit geometry for placement scoring. */
export function getConnectionPagePoints(editor: Editor, connection: ConnectionShape) {
  const { start, end, sideways } = getConnectionTerminals(editor, connection)
  const transform = editor.getShapePageTransform(connection)
  return curvePoints(start, end, sideways).map(point => transform.applyToPoint(point))
}
