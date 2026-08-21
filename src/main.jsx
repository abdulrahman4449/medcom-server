// Entry point. The bundler starts here and pulls in everything reachable.
import { App } from "./ui/App.jsx";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);