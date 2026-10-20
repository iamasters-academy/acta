import { Route, Routes } from 'react-router-dom';
import { AppProvider } from './store';
import { Sidebar } from './components/Sidebar';
import { CommandPalette } from './components/CommandPalette';
import { Toaster } from './components/ui';
import { Home } from './pages/Home';
import { Note } from './pages/Note';
import { FolderPage, TasksPage, PeoplePage, PersonPage, CompaniesPage, CompanyPage, AskPage, ArchivedPage } from './pages/Lists';
import { TemplatesPage } from './pages/Templates';
import { SettingsPage } from './pages/Settings';

export function App() {
  return (
    <AppProvider>
      <div className="flex h-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto bg-canvas">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/nota/:id" element={<Note />} />
            <Route path="/carpeta/:id" element={<FolderPage />} />
            <Route path="/preguntar" element={<AskPage />} />
            <Route path="/tareas" element={<TasksPage />} />
            <Route path="/personas" element={<PeoplePage />} />
            <Route path="/personas/:id" element={<PersonPage />} />
            <Route path="/empresas" element={<CompaniesPage />} />
            <Route path="/empresas/:id" element={<CompanyPage />} />
            <Route path="/plantillas" element={<TemplatesPage />} />
            <Route path="/ajustes" element={<SettingsPage />} />
            <Route path="/papelera" element={<ArchivedPage />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </AppProvider>
  );
}
