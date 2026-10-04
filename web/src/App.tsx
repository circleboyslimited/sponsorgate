import { NotFound, Shell } from "./Shell";
import { Workspace } from "./Workspace";
import { Docs } from "./pages/Docs";
import { Home } from "./pages/Home";
import { useRoute, useTitle } from "./lib/router";

function AppPage() {
  useTitle("Policy console · sponsorgate");
  return <Workspace />;
}

export default function App() {
  const route = useRoute();
  return (
    <Shell route={route} >
      {route === "/" ? <Home /> : route === "/app" ? <AppPage /> : route === "/docs" ? <Docs /> : <NotFound />}
    </Shell>
  );
}
