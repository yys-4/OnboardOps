import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import OverviewPage from '@/pages/OverviewPage';
import IncidentsPage from '@/pages/IncidentsPage';
import PostmortemsPage from '@/pages/PostmortemsPage';
import ArchitecturePage from '@/pages/ArchitecturePage';
import ErrorLabPage from '@/pages/ErrorLabPage';
import FixHubPage from '@/pages/FixHubPage';
import OnboardingExplorerPage from '@/pages/OnboardingExplorerPage';
import IncidentResponseHubPage from '@/pages/IncidentResponseHubPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/onboarding" replace />} />
        <Route path="onboarding" element={<OnboardingExplorerPage />} />
        <Route path="incident-hub" element={<IncidentResponseHubPage />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="postmortems" element={<PostmortemsPage />} />
        <Route path="architecture" element={<ArchitecturePage />} />
        <Route path="error-lab" element={<ErrorLabPage />} />
        <Route path="fix-hub" element={<FixHubPage />} />
      </Route>
    </Routes>
  );
}
