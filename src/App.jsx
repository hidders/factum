import React, { useEffect } from 'react'
import Toolbar from './components/Toolbar'
import ToolPanel from './components/ToolPanel'
import Canvas from './components/Canvas'
import Inspector from './components/Inspector'
import StatusBar from './components/StatusBar'
import WelcomeScreen from './components/WelcomeScreen'
import DiagramTabs from './components/DiagramTabs'
import SchemaBrowser from './components/SchemaBrowser'
import { useElectronMenu } from './hooks/useElectronMenu'
import { useUndoRedo } from './hooks/useUndoRedo'
import { useOrmStore } from './store/ormStore'

function useKeyboardShortcuts() {
  const store = useOrmStore()

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Escape') {
        store.abandonSequenceConstruction()
        store.clearLinkDraft()
        store.clearSelection()
        store.setTool('select')
        return
      }

      if (e.key === 'Enter' && store.sequenceConstruction) {
        const constraintId = store.sequenceConstruction.constraintId
        store.commitSequenceConstruction()
        store.select(constraintId, 'constraint')
        return
      }

      if (e.key === 'Enter' && store.uniquenessConstruction) {
        const factId = store.uniquenessConstruction.factId
        store.commitUniquenessConstruction()
        store.select(factId, 'fact')
        return
      }

      if (isTyping) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedId, selectedKind, selectedUniqueness, uniquenessConstruction, multiSelectedIds, activeDiagramId } = store

        const inAnyDiagram = (id) => {
          const diagrams = useOrmStore.getState().diagrams
          return diagrams.some(d => d.elementIds === null || d.elementIds.includes(id))
        }
        const purgeFromSchema = (id, kind) => {
          const s = useOrmStore.getState()
          if (kind === 'entity' || kind === 'value') { if (s.objectTypes.find(o => o.id === id)) store.deleteObjectType(id) }
          else if (kind === 'fact')       { if (s.facts.find(f => f.id === id))       store.deleteFact(id) }
          else if (kind === 'constraint') { if (s.constraints.find(c => c.id === id)) store.deleteConstraint(id) }
        }

        if (multiSelectedIds.length > 0) {
          const selSet = new Set(multiSelectedIds)
          const s0 = useOrmStore.getState()

          // A constraint is removable only when every fact/OT it references is also in the selection
          const constraintRemovable = (c) => {
            const refs = new Set()
            if (c.sequences) for (const seq of c.sequences) for (const m of seq) { if (m.kind === 'role' && m.factId) refs.add(m.factId) }
            if (c.roleSequences) for (const seq of c.roleSequences) for (const r of seq) { if (r.factId) refs.add(r.factId) }
            if (c.targetObjectTypeId) refs.add(c.targetObjectTypeId)
            return refs.size > 0 && [...refs].every(id => selSet.has(id))
          }

          const idsToRemove = multiSelectedIds.filter(id => {
            const c = s0.constraints.find(c => c.id === id)
            return !c || constraintRemovable(c)
          })

          if (idsToRemove.length > 0) {
            store.removeMultiSelectionFromDiagram(activeDiagramId, idsToRemove)
            for (const id of idsToRemove) {
              if (!inAnyDiagram(id)) {
                const s = useOrmStore.getState()
                const ot = s.objectTypes.find(o => o.id === id)
                if (ot) purgeFromSchema(id, ot.kind)
                else if (s.facts.find(f => f.id === id)) purgeFromSchema(id, 'fact')
              }
            }
          } else {
            store.clearSelection()
          }
          return
        }

        if (uniquenessConstruction?.uIndex != null) {
          // Delete the constraint being edited and exit construction mode
          const fact = store.facts.find(f => f.id === uniquenessConstruction.factId)
          if (fact) store.toggleUniqueness(uniquenessConstruction.factId, fact.uniqueness[uniquenessConstruction.uIndex])
          store.clearSelection()
          return
        }
        if (selectedUniqueness) {
          const fact = store.facts.find(f => f.id === selectedUniqueness.factId)
          if (fact) {
            store.toggleUniqueness(selectedUniqueness.factId, fact.uniqueness[selectedUniqueness.uIndex])
            store.clearSelection()
          }
          return
        }
        if (!selectedId) return
        if (selectedKind === 'constraint') return  // constraints are never removed via keystroke
        // Subtypes are not tracked in elementIds, so always remove from schema.
        // Everything else is removed from the current diagram; if that was the last
        // diagram containing it, also delete it from the schema.
        if (selectedKind === 'subtype') {
          store.deleteSubtype(selectedId)
        } else {
          store.removeElementFromDiagram(selectedId, activeDiagramId)
          if (!inAnyDiagram(selectedId)) purgeFromSchema(selectedId, selectedKind)
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); store.selectAll(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); store.copySelection(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); store.cutSelection();  return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); store.pasteClipboard();    return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); store.duplicateClipboard(); return }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const ids = store.multiSelectedIds.length > 0
          ? store.multiSelectedIds
          : store.selectedId ? [store.selectedId] : []
        if (ids.length === 0) return
        e.preventDefault()
        const step = e.shiftKey ? 50 : 10
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0
        const diagramPositions = useOrmStore.getState().diagrams
          ?.find(d => d.id === store.activeDiagramId)?.positions ?? {}
        for (const id of ids) {
          const dp = diagramPositions[id]
          const ot = store.objectTypes.find(o => o.id === id)
          if (ot) { const p = dp ?? ot; store.moveObjectType(id, p.x + dx, p.y + dy); continue }
          const f  = store.facts.find(f => f.id === id)
          if (f)  { const p = dp ?? f;  store.moveFact(id, p.x + dx, p.y + dy); continue }
          const c  = store.constraints.find(c => c.id === id)
          if (c)  { const p = dp ?? c;  store.moveConstraint(id, p.x + dx, p.y + dy) }
        }
        return
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 's' || e.key === 'S') { store.setTool('select'); return }
      if (e.key === 'e' || e.key === 'E') { store.setTool('addEntity'); return }
      if (e.key === 'v' || e.key === 'V') { store.setTool('addValue'); return }
      if (e.key === 'f' || e.key === 'F') { store.setTool('addFact2'); return }
      if (e.key === 'u' || e.key === 'U') { store.setTool('addSubtype'); return }
      if (e.key === 'a' || e.key === 'A') { store.setTool('assignRole'); return }

      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault(); store.zoomBy(0.1); return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault(); store.zoomBy(-0.1); return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault(); store.resetView(); return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [store])
}

export default function App() {
  const store = useOrmStore()

  useElectronMenu()
  useUndoRedo()
  useKeyboardShortcuts()

  const isEmpty = store.objectTypes.length === 0 && store.facts.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column',
      width: '100vw', height: '100vh', overflow: 'hidden',
      background: 'var(--bg-canvas)' }}>

      <div id="app-toolbar" className="no-print"><Toolbar /></div>

      <div id="app-diagram-tabs" className="no-print"><DiagramTabs /></div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div id="app-toolpanel" className="no-print" style={{ display: 'contents' }}><ToolPanel /></div>
        <Canvas />
        {isEmpty && <WelcomeScreen />}
        <SchemaBrowser />
        <div id="app-inspector" className="no-print" style={{ display: 'contents' }}><Inspector /></div>
      </div>

      <div id="app-statusbar" className="no-print"><StatusBar /></div>
    </div>
  )
}
