import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import CharactersPage from "./pages/CharactersPage";
import WardrobePage from "./pages/WardrobePage";
import MoodPage from "./pages/MoodPage";
import ComposerPage from "./pages/ComposerPage";
import FeedPage from "./pages/FeedPage";
import LogPage from "./pages/LogPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/feed" replace />} />
        <Route path="/characters" element={<CharactersPage />} />
        <Route path="/wardrobe" element={<WardrobePage />} />
        <Route path="/mood" element={<MoodPage />} />
        <Route path="/composer" element={<ComposerPage />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/log" element={<LogPage />} />
      </Route>
    </Routes>
  );
}
