import { Chat } from "./components/Chat";
import { SceneBackground } from "./components/SceneBackground";

export default function App() {
  return (
    <div className="min-h-screen text-white">
      <SceneBackground />
      <Chat />
    </div>
  );
}