import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import CharactersPage from "./pages/CharactersPage";
import WardrobePage from "./pages/WardrobePage";
import MoodPage from "./pages/MoodPage";
import WorldPage from "./pages/WorldPage";
import ComposerPage from "./pages/ComposerPage";
import FeedPage from "./pages/FeedPage";
import InstagramPage from "./pages/InstagramPage";
import InstagramCallbackPage from "./pages/InstagramCallbackPage";
import LogPage from "./pages/LogPage";

export default function App() {
  return (
    <Routes>
      {/* The IG OAuth callback page is OUTSIDE the Layout because it
          renders standalone (it's just a redirect-handler screen — no
          nav, no chrome, redirects elsewhere when done). */}
      <Route path="/auth/instagram/callback" element={<InstagramCallbackPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/feed" replace />} />
        <Route path="/characters" element={<CharactersPage />} />
        <Route path="/wardrobe" element={<WardrobePage />} />
        <Route path="/mood" element={<MoodPage />} />
        <Route path="/world" element={<WorldPage />} />
        <Route path="/composer" element={<ComposerPage />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/instagram" element={<InstagramPage />} />
        <Route path="/log" element={<LogPage />} />
      </Route>
    </Routes>
  );
}
