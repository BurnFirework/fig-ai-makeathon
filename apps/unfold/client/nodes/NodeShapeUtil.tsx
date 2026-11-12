import { actions, uiState, type ExploreRun } from '../actions'
import { cardRow } from '../explore-summary'
import { LoaderCircle } from 'lucide-react'
import {
	Circle2d,
	Group2d,
	HTMLContainer,
	type RecordProps,
	Rectangle2d,
	ShapeUtil,
	type TLShape,
	useEditor,
	useValue,
} from 'tldraw'
import { NODE_WIDTH_PX, PORT_RADIUS_PX } from '../constants'
import { Port } from '../ports/Port'
import { isSidePort } from '../connection/ConnectionShapeUtil'
import { getNodePorts } from './nodePorts'
import {
	getNodeDefinition,
	getNodeHeightPx,
	getNodeTypePorts,
	getNodeWidthPx,
	NodeType,
} from './nodeTypes'

const NODE_TYPE = 'node'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[NODE_TYPE]: { node: NodeType }
	}
}

// Define our custom node shape type that extends tldraw's base shape system
export type NodeShape = TLShape<typeof NODE_TYPE>

// This class extends tldraw's ShapeUtil to define how our custom node shapes behave
export class NodeShapeUtil extends ShapeUtil<NodeShape> {
	static override type = NODE_TYPE
	static override props: RecordProps<NodeShape> = {
		node: NodeType,
	}

	getDefaultProps(): NodeShape['props'] {
		return {
			node: getNodeDefinition(this.editor, 'inspiration').getDefault(),
		}
	}

	override canEdit(_shape: NodeShape) {
		return false
	}
	/** The photo hands its pointer to the canvas, so its double-click arrives here: it opens the card's conversation. */
	override onDoubleClick(shape: NodeShape) {
		if (shape.props.node.type === 'inspiration') actions.get(this.editor)?.openChat(shape.id)
	}
	override canResize(_shape: NodeShape) {
		return false
	}
	override hideResizeHandles(_shape: NodeShape) {
		return true
	}
	override hideRotateHandle(_shape: NodeShape) {
		return true
	}
	override hideSelectionBoundsBg(_shape: NodeShape) {
		return true
	}
	override hideSelectionBoundsFg(_shape: NodeShape) {
		return true
	}
	override isAspectRatioLocked(_shape: NodeShape) {
		return false
	}
	override getBoundsSnapGeometry(_shape: NodeShape) {
		return {
			points: [{ x: 0, y: 0 }],
		}
	}

	// Define the geometry of our node shape including ports
	getGeometry(shape: NodeShape) {
		const ports = getNodePorts(this.editor, shape)

		const portGeometries = Object.values(ports).filter(port => !isSidePort(port.id)).map(
			(port) =>
				new Circle2d({
					x: port.x - PORT_RADIUS_PX,
					y: port.y - PORT_RADIUS_PX,
					radius: PORT_RADIUS_PX,
					isFilled: true,
					// not a label, but this hack excludes them from the selection bounds which is useful
					isLabel: true,
				})
		)

		const bodyGeometry = new Rectangle2d({
			width: getNodeWidthPx(this.editor, shape),
			height: getNodeHeightPx(this.editor, shape),
			isFilled: true,
		})

		return new Group2d({
			children: [bodyGeometry, ...portGeometries],
		})
	}

	component(shape: NodeShape) {
		return <NodeShape shape={shape} />
	}

	getIndicatorPath(shape: NodeShape) {
		const height = getNodeHeightPx(this.editor, shape)
		const path = new Path2D()
		path.rect(0, 0, NODE_WIDTH_PX, height)
		return path
	}
}

// Main node component that renders the HTML content
function NodeShape({ shape }: { shape: NodeShape }) {
	const editor = useEditor()

	return (
		<HTMLContainer
			className="NodeShape"
			style={{
				width: getNodeWidthPx(editor, shape),
				height: getNodeHeightPx(editor, shape),
			}}
		>
			<NodeBody shape={shape} />
			<NodePorts shape={shape} />
            <CardInvestigation shape={shape} />
		</HTMLContainer>
	)
}

function NodeBody({ shape }: { shape: NodeShape }) {
	const node = shape.props.node
	const editor = useEditor()
	const { Component } = getNodeDefinition(editor, node)
	return <Component shape={shape} node={node} />
}

function NodePorts({ shape }: { shape: NodeShape }) {
	const editor = useEditor()
	const ports = useValue('node ports', () => getNodeTypePorts(editor, shape), [shape, editor])
	return (
		<>
			{Object.values(ports).filter(port => !isSidePort(port.id)).map((port) => (
				<Port key={port.id} shapeId={shape.id} port={port} />
			))}
		</>
	)
}

const workersByCard = new WeakMap<ExploreRun['workers'], Map<string, ExploreRun['workers'][number]>>()
const reportsByCard = new WeakMap<NonNullable<ExploreRun['reports']>, Map<string, NonNullable<ExploreRun['reports']>[number]>>()

function workerForCard(workers: ExploreRun['workers'], id: string) {
  let index = workersByCard.get(workers)
  if (!index) {
    index = new Map()
    for (const worker of workers) {
      if (worker.sourceId && index.get(worker.sourceId)?.status !== 'running') index.set(worker.sourceId, worker)
    }
    workersByCard.set(workers, index)
  }
  return index.get(id)
}

function reportForCard(reports: NonNullable<ExploreRun['reports']>, id: string) {
  let index = reportsByCard.get(reports)
  if (!index) {
    index = new Map(reports.map(report => [report.sourceId, report]))
    reportsByCard.set(reports, index)
  }
  return index.get(id)
}

function CardInvestigation({ shape }: { shape: NodeShape }) {
  const editor = useEditor()
  const worker = useValue('card investigation worker', () => {
    const run = uiState.get(editor).explore
    return run ? workerForCard(run.workers, shape.id) : undefined
  }, [editor, shape.id])
  const report = useValue('card investigation result', () => {
    const reports = uiState.get(editor).explore?.reports
    return reports ? reportForCard(reports, shape.id) : undefined
  }, [editor, shape.id])
  const canRetry = useValue('card investigation retry', () => {
    const run = uiState.get(editor).explore
    return Boolean(run?.reports && !run.running && reportForCard(run.reports, shape.id)?.status === 'failed')
  }, [editor, shape.id])
  const tally = useValue('card investigation tally', () => uiState.get(editor).explore?.cards?.[shape.id], [editor, shape.id])
  if (!worker && !report) return null
  // Once the card is done, the chip says what happened in a few words; the agent's full note lives in the results panel.
  const message = report?.status === 'failed' ? report.message : report ? cardRow({ sourceId: report.sourceId, title: '' }, report, tally, false).label : worker?.message
  return <div className="explore-source-status" role="status" title={report?.status === 'complete' ? report.note ?? message : message} onPointerDown={event => editor.markEventAsHandled(event)} onKeyDown={event => event.stopPropagation()}>
    {worker?.status === 'running' && !report && <LoaderCircle size={13} className="spin"/>}<span>{message}</span>
    {canRetry && <button type="button" onClick={() => { actions.get(editor)?.retryExplore().catch(() => {}) }}>Retry</button>}
  </div>
}
