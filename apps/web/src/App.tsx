import { Routes, Route } from 'react-router-dom';
import MapView from './pages/MapView';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MapView />} />
    </Routes>
  );
}
