import { useEffect } from 'react';
import { useAppStore } from './appStore';
import { ProjectsScreen } from './components/ProjectsScreen';
import { TitleBar } from './components/TitleBar';
import { RasterEditor } from './components/raster/RasterEditor';
import { SvgEditor } from './components/svg/SvgEditor';
import { ExportModal } from './components/ExportModal';
import { installQuitFlush, saveCurrentProject } from './projectIO';

export function App() {
  const view = useAppStore((s) => s.view);
  const kind = useAppStore((s) => s.current?.kind);

  // Wire the quit handshake once.
  useEffect(() => {
    installQuitFlush();
  }, []);

  // Manual save (Cmd/Ctrl+S) while the editor is open.
  useEffect(() => {
    if (view !== 'editor') return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveCurrentProject();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view]);

  if (view === 'projects') return <ProjectsScreen />;

  return (
    <div className="flex flex-col h-screen w-screen bg-panel text-white text-sm">
      <TitleBar />
      <div className="flex-1 min-h-0">
        {kind === 'svg' ? <SvgEditor /> : <RasterEditor />}
      </div>
      <ExportModal />
    </div>
  );
}
